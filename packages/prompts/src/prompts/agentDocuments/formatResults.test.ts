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
    it('tells the agent to share a clickable link and hides the internal id', () => {
      const content = formatCreateDocumentResult({
        id: 'assoc-id',
        title: 'Daily Brief',
        url: URL,
      });

      expect(content).toContain('Created document "Daily Brief"');
      expect(content).toContain('clickable markdown link');
      expect(content).toContain(URL);
      expect(content).toContain('Internal id assoc-id');
      expect(content).toContain('never show it to the user');
    });

    it('covers replace / rename / update-load-rule with the same link policy', () => {
      for (const content of [
        formatReplaceDocumentResult({ id: 'a', title: 'T', url: URL }),
        formatRenameDocumentResult({ id: 'a', title: 'New Title', url: URL }),
        formatUpdateLoadRuleResult({ id: 'a', title: 'T', url: URL }),
      ]) {
        expect(content).toContain('clickable markdown link');
        expect(content).toContain(URL);
        expect(content).toContain('never show it to the user');
      }
    });

    it('includes the operation count for modify', () => {
      const content = formatModifyDocumentResult({
        id: 'a',
        operationCount: 3,
        title: 'T',
        url: URL,
      });

      expect(content).toContain('applied 3 operation(s)');
      expect(content).toContain(URL);
    });

    it('names both source and new document for copy', () => {
      const content = formatCopyDocumentResult({
        fromId: 'src-id',
        id: 'new-id',
        title: 'Copy',
        url: URL,
      });

      expect(content).toContain('Copied document src-id');
      expect(content).toContain('"Copy"');
      expect(content).toContain(URL);
      expect(content).toContain('Internal id new-id');
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
