// A fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same answers, different engine. The reference reads one character at a time
// and grows every field by string concatenation; this parser instead works
// with slices and native scans, and only drops to a character loop where the
// spec forces it:
//
//   - Record-level fast path: a record whose text up to its line break holds
//     no double quote and no stray CR is split with String.prototype.split,
//     which runs in native code. That covers the bulk of ordinary records.
//   - Unquoted fields are read by scanning for the next comma / LF / CRLF
//     and slicing the field out in one go; a stray CR only ever splits the
//     field into a short list of segments that are joined at the end.
//   - Quoted fields jump from quote to quote with indexOf. A quoted field
//     with no line break and no doubled quote inside is a single slice.
//     Doubled quotes accumulate as segments; only a field that actually
//     holds a line break inside its quotes falls back to a character loop.
//
// Everything else follows the reference's policy exactly: a U+FEFF at the
// start is dropped; empty lines are no record; a CR outside quotes that is
// not part of CRLF is dropped with a stray_cr error; a field opening with a
// quote runs to the next undoubled quote ("" is one quote, CRLF and lone CR
// inside read as LF), what follows the closing quote up to the next comma or
// line break is appended as it stands (quote_junk when anything was added),
// and a quote that never closes is a literal character with the rest of the
// text re-read as unquoted (unterminated_quote). Short rows are padded and
// long rows cut to the first record's width, each with its error; every error
// is {code, line, row} in the order met, line counting every LF, CRLF and
// lone CR inside quotes. Fields stay strings, never trimmed or converted.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module, stdlib only.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // the next character to read
  let line = 1; // the line that character is on

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // One reusable result slot for the field readers: [value, ended, pos, line, added].
  const out = ['', 0, 0, 0, 0];

  // Joins a field's tail segment onto its value: `parts` holds the earlier
  // segments when a stray CR (unquoted) split the field, else a single slice.
  function joinField(value, parts, seg, end) {
    if (parts) {
      parts.push(text.slice(seg, end));
      return value + parts.join('');
    }
    if (seg < end) return value === '' ? text.slice(seg, end) : value + text.slice(seg, end);
    return value;
  }

  // Reads unquoted characters from `p` onto `value` up to the next comma or
  // line break: a CR not followed by LF is dropped (stray_cr). Writes
  // [value, ended, pos, line, added] into `out`, `added` counting the
  // characters kept (only the junk appended, when called after a quote).
  function scanUnquoted(p, ln, value, out) {
    const startLen = value.length;
    let parts = null;
    let seg = p;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 44) {
        // Comma: the field ends, the record goes on.
        value = joinField(value, parts, seg, p);
        out[0] = value;
        out[1] = COMMA;
        out[2] = p + 1;
        out[3] = ln;
        out[4] = value.length - startLen;
        return out;
      }
      if (c === 10) {
        // LF: the field and the record end.
        value = joinField(value, parts, seg, p);
        out[0] = value;
        out[1] = LINE_BREAK;
        out[2] = p + 1;
        out[3] = ln + 1;
        out[4] = value.length - startLen;
        return out;
      }
      if (c === 13) {
        if (text.charCodeAt(p + 1) === 10) {
          // CRLF: the field and the record end.
          value = joinField(value, parts, seg, p);
          out[0] = value;
          out[1] = LINE_BREAK;
          out[2] = p + 2;
          out[3] = ln + 1;
          out[4] = value.length - startLen;
          return out;
        }
        // A lone CR outside quotes is dropped.
        errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
        if (!parts) parts = [];
        parts.push(text.slice(seg, p));
        p += 1;
        seg = p;
        continue;
      }
      p += 1;
    }
    value = joinField(value, parts, seg, p);
    out[0] = value;
    out[1] = END;
    out[2] = p;
    out[3] = ln;
    out[4] = value.length - startLen;
    return out;
  }

  // What follows a quoted field's closing quote: a comma, a line break, the
  // end of the text, or junk appended as it stands up to the next comma or
  // line break (quote_junk, when anything was added).
  function finishQuoted(value, p, ln, out) {
    if (p >= n) {
      out[0] = value;
      out[1] = END;
      out[2] = p;
      out[3] = ln;
      out[4] = 0;
      return out;
    }
    const c = text.charCodeAt(p);
    if (c === 44) {
      out[0] = value;
      out[1] = COMMA;
      out[2] = p + 1;
      out[3] = ln;
      out[4] = 0;
      return out;
    }
    if (c === 10) {
      out[0] = value;
      out[1] = LINE_BREAK;
      out[2] = p + 1;
      out[3] = ln + 1;
      out[4] = 0;
      return out;
    }
    if (c === 13 && text.charCodeAt(p + 1) === 10) {
      out[0] = value;
      out[1] = LINE_BREAK;
      out[2] = p + 2;
      out[3] = ln + 1;
      out[4] = 0;
      return out;
    }
    const res = scanUnquoted(p, ln, value, out);
    if (res[4] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return res;
  }

  // Reads a quoted field whose opening quote is at `p`, jumping from quote
  // to quote. A line break inside the quotes hands the field to the slow
  // reader below; a quote that never closes is a literal character and the
  // text after it is read again as unquoted.
  function scanQuoted(p, ln, out) {
    const open = p;
    const openLine = ln;
    let parts = null;
    let cur = p + 1;
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        return scanUnquoted(open + 1, openLine, '"', out);
      }
      // The segment up to this quote is the field's next piece; a line break
      // in it means the field needs the slow reader.
      const seg = text.slice(cur, q);
      if (seg.indexOf('\n') !== -1 || seg.indexOf('\r') !== -1) {
        return scanQuotedSlow(cur, ln, parts, open, openLine, out);
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field.
        if (!parts) parts = [];
        parts.push(seg, '"');
        cur = q + 2;
        continue;
      }
      // The closing quote: the field is this piece (plus any doubled quotes).
      const value = parts ? parts.join('') + seg : seg;
      return finishQuoted(value, q + 1, ln, out);
    }
  }

  // The slow quoted reader: a quoted field that holds a line break inside
  // its quotes. Each CRLF or lone CR inside reads as one LF; line counts
  // every one of them. `parts` holds segments gathered before this call.
  function scanQuotedSlow(cur, ln, parts, open, openLine, out) {
    let p = cur;
    let seg = cur;
    while (p < n) {
      const c = text.charCodeAt(p);
      if (c === 34) {
        if (text.charCodeAt(p + 1) === 34) {
          if (!parts) parts = [];
          parts.push(text.slice(seg, p), '"');
          p += 2;
          seg = p;
          continue;
        }
        let value;
        if (parts) {
          parts.push(text.slice(seg, p));
          value = parts.join('');
        } else {
          value = text.slice(seg, p);
        }
        return finishQuoted(value, p + 1, ln, out);
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (!parts) parts = [];
        parts.push(text.slice(seg, p), '\n');
        ln += 1;
        p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
        seg = p;
        continue;
      }
      if (c === 10) {
        if (!parts) parts = [];
        parts.push(text.slice(seg, p), '\n');
        ln += 1;
        p += 1;
        seg = p;
        continue;
      }
      p += 1;
    }
    // The quote never closes: it is a literal character, and the text after
    // it is read again as unquoted.
    errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
    return scanUnquoted(open + 1, openLine, '"', out);
  }

  // Ends a record: the header, or a row padded or cut to the first record's
  // width, with its short_row or long_row error.
  function finishRecord(fields) {
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Record-level fast path: the record's text up to its line break holds
    // no quote and no stray CR, so it is plain fields split in native code.
    const nl = text.indexOf('\n', pos);
    const segEnd = nl === -1 ? n : nl;
    const q = text.indexOf('"', pos);
    if (q === -1 || q >= segEnd) {
      const r = text.indexOf('\r', pos);
      if (r === -1 || r >= segEnd) {
        const fields = text.slice(pos, segEnd).split(',');
        if (nl === -1) {
          pos = n;
        } else {
          pos = nl + 1;
          line += 1;
        }
        finishRecord(fields);
        continue;
      }
      // The only CR is the trailing one of a CRLF line break.
      const r2 = text.indexOf('\r', r + 1);
      if (nl !== -1 && r === segEnd - 1 && (r2 === -1 || r2 >= segEnd)) {
        const fields = text.slice(pos, segEnd - 1).split(',');
        pos = nl + 1;
        line += 1;
        finishRecord(fields);
        continue;
      }
      // A stray CR inside the record: fall through to the field reader.
    }

    // The general path: a record holding at least one quote (or a stray CR).
    // Unquoted fields are scanned inline here, so the hot path pays no call
    // and no result slot; quoted fields go through scanQuoted.
    const fields = [];
    let quoted = false;
    let ended;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        scanQuoted(pos, line, out);
        fields.push(out[0]);
        ended = out[1];
        pos = out[2];
        line = out[3];
        continue;
      }
      // Unquoted field: scan for the next comma or line break, slicing the
      // field out in one go; a lone CR is dropped (stray_cr) and splits the
      // field into segments joined at its end.
      let seg = pos;
      let parts = null;
      let value = '';
      let p = pos;
      let ln = line;
      ended = END;
      while (p < n) {
        const c = text.charCodeAt(p);
        if (c === 44) {
          value = joinField(value, parts, seg, p);
          ended = COMMA;
          p += 1;
          break;
        }
        if (c === 10) {
          value = joinField(value, parts, seg, p);
          ended = LINE_BREAK;
          p += 1;
          ln += 1;
          break;
        }
        if (c === 13) {
          if (text.charCodeAt(p + 1) === 10) {
            value = joinField(value, parts, seg, p);
            ended = LINE_BREAK;
            p += 2;
            ln += 1;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          if (!parts) parts = [];
          parts.push(text.slice(seg, p));
          p += 1;
          seg = p;
          continue;
        }
        p += 1;
      }
      if (ended === END) value = joinField(value, parts, seg, p);
      fields.push(value);
      pos = p;
      line = ln;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    finishRecord(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
