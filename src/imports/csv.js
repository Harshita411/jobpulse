import { createHash } from 'node:crypto';
import { parse } from 'csv-parse';

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 10000;
export const BATCH_SIZE = 100;
export const SCHEMA_VERSION = 1;
export const isImportId = value => /^[a-f0-9]{64}$/.test(value);

export class InvalidCsvError extends Error {}

export function validateFileBytes(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_BYTES) {
    throw new InvalidCsvError('CSV must contain 1 byte to 2 MB');
  }
  try { new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new InvalidCsvError('CSV must be UTF-8 text'); }
  if (buffer.includes(0)) throw new InvalidCsvError('CSV must not contain NUL bytes');
}

// The schema prefix prevents a future schema change from reusing old row identities.
export function importIdFor(buffer, ownerId) {
  const scope = ownerId ? `owner:${ownerId}\0` : '';
  return createHash('sha256').update(`jobpulse-csv-v${SCHEMA_VERSION}\0${scope}`).update(buffer).digest('hex');
}

export async function* csvRows(buffer) {
  validateFileBytes(buffer);
  let parsedRecords = 0;
  const parser = parse({
    bom: true, trim: true, skip_empty_lines: true,
    relax_column_count: true, max_record_size: 16 * 1024,
    on_record(record) {
      parsedRecords += 1;
      if (parsedRecords > MAX_ROWS + 1) throw new InvalidCsvError('CSV exceeds 10000 data rows');
      return record;
    },
  });
  parser.end(buffer);
  let header = false;
  let rowNumber = 0;
  try {
    for await (const fields of parser) {
      if (!header) {
        if (fields.length !== 3 || fields.join(',') !== 'name,email,age') {
          throw new InvalidCsvError('Expected CSV header: name,email,age');
        }
        header = true;
        continue;
      }
      rowNumber += 1;
      if (rowNumber > MAX_ROWS) throw new InvalidCsvError('CSV exceeds 10000 data rows');
      yield { rowNumber, record: validateRow(fields) };
    }
    if (!header || !rowNumber) throw new InvalidCsvError('CSV must include a header and at least one data row');
  } catch (error) {
    if (error instanceof InvalidCsvError) throw error;
    // Do not expose source content contained in parser errors.
    throw new InvalidCsvError('Malformed CSV or record exceeds 16 KB');
  } finally {
    parser.destroy();
  }
}

export function validateRow(fields) {
  if (fields.length !== 3) return null;
  const [name, email, age] = fields;
  if (!name || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) return null;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (!/^\d{1,3}$/.test(age) || Number(age) > 120) return null;
  return { name, email: email.toLowerCase(), age: Number(age) };
}
