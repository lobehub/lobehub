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
 * Category filter outcome for one storage table:
 * - a SQL condition to apply,
 * - `'all'` — the category does not constrain this table (no condition),
 * - `'none'` — the category can never match rows of this table.
 */
export type CategoryFilterResult = SQL | 'all' | 'none';

/**
 * Uploaded document files: any `text/*` file plus office / pdf style
 * `application/*` types. Derived pages/notes are NOT documents — they live in
 * the documents table and belong to the Pages category.
 */
const documentFileCondition = (column: SQLWrapper): SQL => {
  const orConditions = [
    sql`${column} ILIKE ${'text/%'}`,
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
    sql`NOT ${documentFileCondition(column)}`,
    ...MEDIA_PREFIXES.map((prefix) => sql`${column} NOT ILIKE ${`${prefix}%`}`),
    sql`${column} NOT ILIKE ${'custom/%'}`,
  ];
  return sql`(${sql.join(andConditions, sql` AND `)})`;
};

/**
 * Category filter for the `files` table (uploaded files).
 *
 * `column` is the `file_type` column to match against — either a drizzle
 * column or a raw aliased reference (e.g. `sql.raw('f.file_type')`).
 */
export const buildFileCategoryFilter = (
  column: SQLWrapper,
  category: FilesTabs,
): CategoryFilterResult => {
  switch (category) {
    case FilesTabs.Audios: {
      return sql`${column} ILIKE ${'audio%'}`;
    }
    case FilesTabs.Documents: {
      return documentFileCondition(column);
    }
    case FilesTabs.Files: {
      return rawFileCondition(column);
    }
    case FilesTabs.Images: {
      return sql`${column} ILIKE ${'image%'}`;
    }
    case FilesTabs.Pages: {
      // Pages are derived documents; uploaded files never qualify.
      return 'none';
    }
    case FilesTabs.Videos: {
      return sql`${column} ILIKE ${'video%'}`;
    }
    case FilesTabs.Websites: {
      return sql`${column} ILIKE ${'text/html%'}`;
    }
    default: {
      return 'all';
    }
  }
};

/**
 * Category filter for the `documents` table (derived pages / notes).
 *
 * Only the Pages category (and the unconstrained All view) surfaces document
 * rows; every file-oriented category excludes the table entirely.
 */
export const buildDocumentCategoryFilter = (
  column: SQLWrapper,
  category: FilesTabs,
): CategoryFilterResult => {
  switch (category) {
    case FilesTabs.All:
    case FilesTabs.Home: {
      return 'all';
    }
    case FilesTabs.Pages: {
      return sql`(${column} ILIKE ${'custom/%'} AND ${column} != ${'custom/folder'})`;
    }
    case FilesTabs.Websites: {
      // web clippings: article documents plus raw html captures
      return sql`(${column} = ${'article'} OR ${column} ILIKE ${'text/html%'})`;
    }
    default: {
      return 'none';
    }
  }
};
