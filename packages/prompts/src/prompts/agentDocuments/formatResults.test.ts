import { describe, expect, it } from 'vitest';

import {
  formatCopyDocumentResult,
  formatCreateDocumentResult,
  formatModifyDocumentResult,
  formatRemoveDocumentResult,
  formatRenameDocumentResult,
  formatReplaceDocumentResult,
  formatUpdateLoadRuleResult,
} from './formatResults';

const URL = 'https://app.example.com/agent/agent-1/docs/docs_row';

describe('agentDocuments formatResults', () => {
  describe('with a url present', () => {
    it('formats create with a clickable link and the internal id hidden', () => {
      expect(formatCreateDocumentResult({ id: 'assoc-id', title: 'Daily Brief', url: URL })).toBe(
        `Created document "Daily Brief". Share this link with the user as a clickable markdown link: ${URL}. (Internal id assoc-id — for your own further edit/read/remove calls only; never show it to the user.)`,
      );
    });

    it('formats replace', () => {
      expect(formatReplaceDocumentResult({ id: 'a', title: 'T', url: URL })).toBe(
        `Updated document "T". Share this link with the user as a clickable markdown link: ${URL}. (Internal id a — for your own further edit/read/remove calls only; never show it to the user.)`,
      );
    });

    it('formats rename with the new title', () => {
      expect(formatRenameDocumentResult({ id: 'a', title: 'New Title', url: URL })).toBe(
        `Renamed document to "New Title". Share this link with the user as a clickable markdown link: ${URL}. (Internal id a — for your own further edit/read/remove calls only; never show it to the user.)`,
      );
    });

    it('formats update-load-rule', () => {
      expect(formatUpdateLoadRuleResult({ id: 'a', title: 'T', url: URL })).toBe(
        `Updated load rule for document "T". Share this link with the user as a clickable markdown link: ${URL}. (Internal id a — for your own further edit/read/remove calls only; never show it to the user.)`,
      );
    });

    it('formats modify with the operation count', () => {
      expect(formatModifyDocumentResult({ id: 'a', operationCount: 3, title: 'T', url: URL })).toBe(
        `Modified document "T", applied 3 operation(s). Share this link with the user as a clickable markdown link: ${URL}. (Internal id a — for your own further edit/read/remove calls only; never show it to the user.)`,
      );
    });

    it('formats copy naming both source and new document', () => {
      expect(
        formatCopyDocumentResult({ fromId: 'src-id', id: 'new-id', title: 'Copy', url: URL }),
      ).toBe(
        `Copied document src-id to a new document "Copy". Share this link with the user as a clickable markdown link: ${URL}. (Internal id new-id — for your own further edit/read/remove calls only; never show it to the user.)`,
      );
    });
  });

  describe('without a url', () => {
    it('falls back to exposing the id as the only handle', () => {
      expect(formatCreateDocumentResult({ id: 'assoc-id', title: 'Daily Brief' })).toBe(
        'Created document "Daily Brief" (internal id: assoc-id).',
      );
    });

    it('uses a generic label when no title is provided', () => {
      expect(formatReplaceDocumentResult({ id: 'assoc-id' })).toBe(
        'Updated document the document (internal id: assoc-id).',
      );
    });
  });

  it('reports removal with only the id (no live url to share)', () => {
    expect(formatRemoveDocumentResult({ id: 'assoc-id' })).toBe('Removed document assoc-id.');
  });
});
