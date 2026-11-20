import { describe, expect, it } from 'vitest';

import { describeCurrentParent, describeDocumentRef } from './describeDocumentRef';

const rows = [
  {
    documentId: 'docs_sop',
    fileType: 'agent/document',
    id: 'row-sop',
    parentId: null,
    title: 'SOP',
  },
  {
    documentId: 'docs_folder',
    fileType: 'custom/folder',
    id: 'row-folder',
    parentId: null,
    title: 'Reports',
  },
  {
    documentId: 'docs_run',
    fileType: 'agent/document',
    id: 'row-run',
    parentId: 'docs_sop',
    title: 'Run',
  },
];
const lookup = (ref?: string | null) => rows.find((r) => r.id === ref || r.documentId === ref);

// Approval and result cards show titles, never the raw ids the model sends.
describe('describeDocumentRef', () => {
  it('reads a missing id as the root', () => {
    expect(describeDocumentRef(lookup, null)).toEqual({ kind: 'root' });
    expect(describeDocumentRef(lookup, undefined)).toEqual({ kind: 'root' });
  });

  it('resolves either id of a row to its title and kind', () => {
    expect(describeDocumentRef(lookup, 'docs_folder')).toEqual({
      kind: 'folder',
      title: 'Reports',
    });
    expect(describeDocumentRef(lookup, 'row-sop')).toEqual({ kind: 'document', title: 'SOP' });
  });

  it('falls back to the title a result carried, then to an unknown id', () => {
    expect(describeDocumentRef(lookup, 'row-gone', 'Deleted run')).toEqual({
      kind: 'document',
      title: 'Deleted run',
    });
    expect(describeDocumentRef(lookup, 'row-gone')).toEqual({ id: 'row-gone', kind: 'unknown' });
  });

  it('describes where a document sits now, the root when it has no parent', () => {
    expect(describeCurrentParent(lookup, 'row-run')).toEqual({ kind: 'document', title: 'SOP' });
    expect(describeCurrentParent(lookup, 'row-folder')).toEqual({ kind: 'root' });
  });
});
