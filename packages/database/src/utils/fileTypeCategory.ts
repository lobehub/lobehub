import { FilesTabs } from '@lobechat/types';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

/**
 * `application/*` MIME prefixes that are human-readable documents rather than
 * raw data files. Everything else under `application/*` (json, zip,
 * octet-stream, …) belongs to the Files category.
 */
const DOCUMENT_APPLICATION_PREFIXES = [
  'application/epub',
  'application/msword',
  'application/pdf',
  'application/rtf',
  'application/vnd.apple.keynote',
  'application/vnd.apple.numbers',
  'application/vnd.apple.pages',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument',
  'application/vnd.openxmlformats-officedocument',
];

const MEDIA_PREFIXES = ['audio', 'image', 'video'];

/**
 * Document-like resources: any `text/*` file, synthetic documents
 * (`custom/document`, `custom/note`, … — everything but folders), and
 * office / pdf style `application/*` types.
 */
const documentCondition = (column: SQLWrapper): SQL => {
  const orConditions = [
    sql`${column} ILIKE ${'text/%'}`,
    sql`(${column} ILIKE ${'custom/%'} AND ${column} != ${'custom/folder'})`,
    ...DOCUMENT_APPLICATION_PREFIXES.map((prefix) => sql`${column} ILIKE ${`${prefix}%`}`),
  ];
  return sql`(${sql.join(orConditions, sql` OR `)})`;
};

/**
 * Raw data files: everything that is not media, not a document and not a
 * synthetic `custom/*` row (folders, pages).
 */
const rawFileCondition = (column: SQLWrapper): SQL => {
  const andConditions = [
    sql`NOT ${documentCondition(column)}`,
    ...MEDIA_PREFIXES.map((prefix) => sql`${column} NOT ILIKE ${`${prefix}%`}`),
    sql`${column} NOT ILIKE ${'custom/%'}`,
  ];
  return sql`(${sql.join(andConditions, sql` AND `)})`;
};

/**
 * Build the `file_type` condition for a resource category.
 *
 * `column` is the `file_type` column to match against — either a drizzle
 * column or a raw aliased reference (e.g. `sql.raw('f.file_type')`).
 *
 * Returns `undefined` when the category does not constrain the file type
 * (All / Home / unknown values).
 */
export const buildFileTypeCategoryFilter = (
  column: SQLWrapper,
  category: FilesTabs,
): SQL | undefined => {
  switch (category) {
    case FilesTabs.Audios: {
      return sql`${column} ILIKE ${'audio%'}`;
    }
    case FilesTabs.Documents: {
      return documentCondition(column);
    }
    case FilesTabs.Files: {
      return rawFileCondition(column);
    }
    case FilesTabs.Images: {
      return sql`${column} ILIKE ${'image%'}`;
    }
    case FilesTabs.Videos: {
      return sql`${column} ILIKE ${'video%'}`;
    }
    case FilesTabs.Websites: {
      return sql`${column} ILIKE ${'text/html%'}`;
    }
    default: {
      return undefined;
    }
  }
};
