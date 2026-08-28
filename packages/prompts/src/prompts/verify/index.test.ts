import { describe, expect, it } from 'vitest';

import { buildVerifierPrompt } from './index';

const checkItem = {
  id: 'check-1',
  index: 0,
  onFail: 'manual' as const,
  required: true,
  title: 'Read the manuscript',
  verifierConfig: {},
  verifierType: 'agent' as const,
};

describe('buildVerifierPrompt', () => {
  it('distinguishes readable agent document ids from backing document ids', () => {
    const prompt = buildVerifierPrompt({
      checkItem,
      deliverable: 'Draft complete',
      goal: 'Write a novel',
      taskDocuments: [
        {
          agentDocumentId: 'agent-doc-manuscript',
          documentId: 'docs-manuscript',
        },
      ],
    });

    expect(prompt).toContain('## Task documents');
    expect(prompt).toContain(
      'agentDocumentId: agent-doc-manuscript (backing documentId: docs-manuscript)',
    );
    expect(prompt).toContain('Use `lobe-agent-documents.readDocument` with the `agentDocumentId`');
  });

  it('omits the task document section when no documents are available', () => {
    const prompt = buildVerifierPrompt({
      checkItem,
      deliverable: 'Done',
      goal: 'Ship it',
    });

    expect(prompt).not.toContain('## Task documents');
  });
});
