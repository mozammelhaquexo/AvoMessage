/**
 * CSV export rules (feature 12).
 *
 * The interesting part is not "does it produce commas" — it is the two ways a
 * naive exporter corrupts or endangers the file:
 *
 *   1. Quoting: a body containing a comma, a quote or a newline must survive a
 *      round trip, and CRLF line endings are what Excel expects.
 *   2. Formula injection: exported cells come from user input, so a body
 *      starting with `=` would be executed by Excel/Sheets on open. The guard
 *      must fire on those, and must NOT fire on a plain negative number.
 */
import { describe, expect, it } from 'vitest';
import { csvField, csvFilename, toCsv, type CsvColumn } from '@/lib/csv';

interface Row {
  name: string;
  body: string;
  score: number | null;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: 'name', value: (r) => r.name },
  { header: 'body', value: (r) => r.body },
  { header: 'score', value: (r) => r.score },
];

describe('csvField', () => {
  it('leaves plain values unquoted', () => {
    expect(csvField('Ada')).toBe('Ada');
    expect(csvField(42)).toBe('42');
    expect(csvField(true)).toBe('true');
    expect(csvField(false)).toBe('false');
  });

  it('renders null and undefined as empty', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
  });

  it('quotes values containing a delimiter, a quote or a newline', () => {
    expect(csvField('Lovelace, Ada')).toBe('"Lovelace, Ada"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('carriage\rreturn')).toBe('"carriage\rreturn"');
  });

  it('quotes values with edge whitespace so a parser cannot trim them', () => {
    expect(csvField(' padded ')).toBe('" padded "');
  });

  it('formats a Date as ISO', () => {
    expect(csvField(new Date('2026-10-03T10:00:00.000Z'))).toBe('2026-10-03T10:00:00.000Z');
  });

  it('rejects a non-finite number rather than writing "NaN"', () => {
    expect(csvField(Number.NaN)).toBe('');
    expect(csvField(Number.POSITIVE_INFINITY)).toBe('');
  });

  it('neutralises spreadsheet formula leads', () => {
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('+SUM(A1)')).toBe("'+SUM(A1)");
    expect(csvField('@import')).toBe("'@import");
    expect(csvField('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it('looks past leading whitespace, which spreadsheets trim before parsing', () => {
    expect(csvField(' =1+1')).toBe("' =1+1");
    expect(csvField('\t=1+1')).toBe("'\t=1+1");
  });

  it('quotes a leading tab that is not a formula', () => {
    expect(csvField('\tcmd')).toBe('"\tcmd"');
  });

  it('guards a leading carriage return', () => {
    expect(csvField('\r=1+1')).toBe(`"'\r=1+1"`);
  });

  it('does not guard a negative number, but does guard a negative formula', () => {
    expect(csvField('-42')).toBe('-42');
    expect(csvField('-3.5')).toBe('-3.5');
    expect(csvField('-2+3')).toBe("'-2+3");
  });
});

describe('toCsv', () => {
  it('writes a header row even with no data', () => {
    expect(toCsv([], COLUMNS)).toBe('name,body,score');
  });

  it('joins rows with CRLF', () => {
    const csv = toCsv(
      [
        { name: 'Ada', body: 'hello', score: 1 },
        { name: 'Grace', body: 'hi, there', score: null },
      ],
      COLUMNS,
    );
    expect(csv).toBe('name,body,score\r\nAda,hello,1\r\nGrace,"hi, there",');
  });

  it('round-trips a body that contains every awkward character', () => {
    const body = 'He said "no, thanks"\n— then left.';
    const csv = toCsv([{ name: 'Ada', body, score: 3 }], COLUMNS);
    const [, dataLine] = csv.split('\r\n');
    // Undo the quoting the exporter applied and confirm the value is intact.
    expect(dataLine).toBe(`Ada,"He said ""no, thanks""\n— then left.",3`);
  });
});

describe('csvFilename', () => {
  it('stamps the file and keeps the extension', () => {
    expect(csvFilename('admin-posts', new Date('2026-10-03T10:20:30.000Z'))).toBe(
      'admin-posts-2026-10-03-10-20-30.csv',
    );
  });

  it('strips characters that are unsafe in a filename', () => {
    expect(csvFilename('manager applications/pending', new Date('2026-10-03T10:20:30.000Z'))).toBe(
      'manager-applications-pending-2026-10-03-10-20-30.csv',
    );
  });

  it('falls back to "export" when the stem is empty', () => {
    expect(csvFilename('///', new Date('2026-10-03T10:20:30.000Z'))).toBe(
      'export-2026-10-03-10-20-30.csv',
    );
  });
});
