import { describe, expect, it } from 'vitest';

import {
  formatCopyDocumentResult,
  formatCreateDocumentResult,
  formatCreateFolderResult,
  formatModifyDocumentResult,
  formatMoveDocumentsResult,
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

  // A maxTokens/priority-only update used to read as plain success while the
  // document stayed progressive, so agents promised automatic loading (T-14044).
  describe('update-load-rule effect', () => {
    it('says a progressive document is not injected and its cap is inert', () => {
      expect(
        formatUpdateLoadRuleResult({
          id: 'a',
          maxTokens: 900,
          policyLoad: 'progressive',
          priority: 2,
          title: 'T',
        }),
      ).toBe(
        'Updated load rule for document "T" (internal id: a). Load mode is "progressive": only its title is listed in agent_documents_index and its content is not injected automatically; read it with readDocument when needed. maxTokens and priority take effect only after setting rule.mode to "always".',
      );
    });

    it('omits the inert-cap note when no cap or priority is stored', () => {
      expect(formatUpdateLoadRuleResult({ id: 'a', policyLoad: 'progressive' })).not.toContain(
        'maxTokens and priority',
      );
    });

    it('states the cap and priority an always-loaded document is injected with', () => {
      expect(
        formatUpdateLoadRuleResult({
          id: 'a',
          maxTokens: 900,
          policyLoad: 'always',
          priority: 2,
          title: 'T',
          url: URL,
        }),
      ).toBe(
        `Updated load rule for document "T". Share this link with the user as a clickable markdown link: ${URL}. (Internal id a — for your own further edit/read/remove calls only; never show it to the user.) Load mode is now "always": its full content is injected into this agent's context on every later model call, truncated to about 900 tokens, priority 2 (lower loads first).`,
      );
    });

    it('flags an always-loaded document without a token cap', () => {
      expect(formatUpdateLoadRuleResult({ id: 'a', maxTokens: null, policyLoad: 'always' })).toBe(
        'Updated load rule for document the document (internal id: a). Load mode is now "always": its full content is injected into this agent\'s context on every later model call, with no token cap (set maxTokens to limit it).',
      );
    });

    it('says a disabled document is not loaded', () => {
      expect(formatUpdateLoadRuleResult({ id: 'a', policyLoad: 'disabled' })).toMatch(
        /Load mode is "disabled": it is not loaded into context\.$/,
      );
    });
  });

  it('reports removal with only the id (no live url to share)', () => {
    expect(formatRemoveDocumentResult({ id: 'assoc-id' })).toBe('Removed document assoc-id.');
  });

  describe('folder results', () => {
    it('hands back the folder id for parentId and marks reuse', () => {
      expect(formatCreateFolderResult({ created: true, folderId: 'docs_f', title: 'P95' })).toBe(
        'Created folder "P95" (folder id: docs_f). Pass this id as parentId to createDocument, moveDocuments or listDocuments. It is an internal handle; never show it to the user.',
      );
      expect(
        formatCreateFolderResult({ created: false, folderId: 'docs_f', title: 'P95' }),
      ).toMatch(/^Reused existing folder "P95"/);
    });

    it('summarizes a move and lists only the failures', () => {
      expect(
        formatMoveDocumentsResult({
          parentId: null,
          results: [
            { id: 'a', status: 'moved', title: 'A' },
            { error: 'Skill documents cannot be moved.', id: 'b', status: 'failed', title: 'B' },
          ],
        }),
      ).toBe(
        'Moved 1 item(s) to the root; 0 already there; 1 failed.\nFailed:\n- "B" (b): Skill documents cannot be moved.',
      );
    });
  });
});
