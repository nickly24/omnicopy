const {test} = require('node:test');
const assert = require('node:assert/strict');
const {parse, columnName} = require('../static/buffer-tables.js');
const sample = 'amikhailin\tdb/changelog/2_commands.xml\t2026-07-08 14:55:21.205107\t17\n' +
  'amikhailin\tdb/changelog/2_commands.xml\t2026-07-08 14:55:21.212322\t18\n' +
  'a.ashutov\tdb/changelog/20260708_DL-614.xml\t2026-07-08 14:55:21.175852\t13\n' +
  'a.ashutov\tdb/changelog/20260708_DL-614.xml\t2026-07-08 14:55:21.180513\t14\n' +
  'a.ashutov\tdb/changelog/20260708_DL-614.xml\t2026-07-08 14:55:21.188096\t15\n' +
  'a.ashutov\tdb/changelog/1_locker.xml\t2026-07-08 14:55:21.05879\t1';
test('DBeaver example: six rows, four columns, intact timestamps', () => {
  const table = parse(sample);
  assert.equal(table.rows.length, 6); assert.equal(table.columns, 4);
  assert.equal(table.rows[0][2], '2026-07-08 14:55:21.205107');
  assert.equal(table.rows[5][3], '1');
});
test('aligned spaces preserve single spaces in values', () => {
  assert.deepEqual(parse('user  2026-07-08 14:55:21  17\nother  2026-07-08 15:01:02  18').rows[0], ['user','2026-07-08 14:55:21','17']);
});
test('TSV preserves empty cells, unicode, CRLF and trailing empty columns', () => {
  assert.deepEqual(parse('Иван\t\t17\t\r\nАнна\tNULL\t18\t\r\n').rows, [['Иван','','17',''],['Анна','NULL','18','']]);
});
test('quoted TSV supports tabs, multiline cells and escaped quotes', () => {
  assert.deepEqual(parse('"a\tb"\t"line 1\nline 2"\n"say ""hi"""\tx').rows, [['a\tb','line 1\nline 2'],['say "hi"','x']]);
});
test('plain text, uneven rows and malformed quotes are not tables', () => {
  for (const text of ['', 'one line', 'some normal text\nanother normal line', 'a\tb\nc', '"unclosed\tb\nx\ty', 'a\tb']) assert.equal(parse(text), null);
});
test('untrusted markup remains literal cell data and names pass Z', () => {
  assert.equal(parse('<img src=x onerror=alert(1)>\t1\nx\t2').rows[0][0], '<img src=x onerror=alert(1)>');
  assert.equal(columnName(0), 'A'); assert.equal(columnName(26), 'AA');
});
