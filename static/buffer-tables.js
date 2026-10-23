// Keep the source untouched: tables are only a view over clipboard text.
(function (root) {
  function parse(text) {
    const source = text.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
    if (!source) return null;
    let rows;
    if (source.includes('\t')) {
      rows = []; let row = [], cell = '', quoted = false, closed = false;
      for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (quoted) {
          if (c === '"' && source[i + 1] === '"') { cell += '"'; i++; }
          else if (c === '"') { quoted = false; closed = true; }
          else cell += c;
        } else if (c === '\t' || c === '\n') {
          row.push(cell); cell = ''; closed = false;
          if (c === '\n') { rows.push(row); row = []; }
        } else if (c === '"' && cell === '' && !closed) quoted = true;
        else {
          if (closed) return null;
          cell += c;
        }
      }
      if (quoted) return null;
      row.push(cell); rows.push(row);
    } else {
      // Single spaces belong to values (for example date + time). Only aligned
      // columns separated by multiple spaces are considered a table.
      rows = source.split('\n').map(line => line.trim().split(/ {2,}/));
    }
    const columns = rows[0].length;
    if (rows.length < 2 || columns < 2 || columns > 200 || rows.some(row => row.length !== columns)) return null;
    return {rows, columns};
  }
  function columnName(index) {
    let name = '';
    for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
    return name;
  }
  const api = {parse, columnName};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.bufferTables = api;
})(typeof window !== 'undefined' ? window : globalThis);
