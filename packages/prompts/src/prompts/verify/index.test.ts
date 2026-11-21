import { describe, expect, it } from 'vitest';

import {
  buildAcceptanceRepairPrompt,
  buildLocalAcceptanceRepairPrompt,
  buildVerifierPrompt,
} from './index';

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

describe('buildAcceptanceRepairPrompt', () => {
  it('carries the round-level reject reason, which feedback --actionable does not print', () => {
    const prompt = buildAcceptanceRepairPrompt('acc-1', '能否录一个视频看下？');

    expect(prompt.startsWith('The reviewer sent this delivery back with this reason:')).toBe(true);
    expect(prompt).toContain('能否录一个视频看下？');
    expect(prompt).toContain('lh acceptance feedback acc-1 --actionable');
  });

  it('stays the plain CLI handoff without a reason', () => {
    expect(buildAcceptanceRepairPrompt('acc-1')).toMatch(/^Use the LobeHub CLI/);
  });
});

describe('buildLocalAcceptanceRepairPrompt', () => {
  it('reads feedback from the acceptance directory and renders the repair back into it', () => {
    const prompt = buildLocalAcceptanceRepairPrompt('.acceptances/task-T-12', 'Focus is lost');
    expect(
      prompt.startsWith('The reviewer sent this delivery back with this reason:\n\nFocus is lost'),
    ).toBe(true);
    expect(prompt).toContain('lh acceptance feedback .acceptances/task-T-12 --actionable');
    expect(prompt).toContain('lh acceptance run render <roundDir>');
    expect(prompt).not.toContain('ingest');
  });
});
