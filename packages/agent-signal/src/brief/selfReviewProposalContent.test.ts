import { describe, expect, it } from 'vitest';

import {
  getSelfReviewProposalContent,
  hasSelfReviewProposalContent,
} from './selfReviewProposalContent';

const withActions = (actions: unknown[]) => ({
  agentSignal: { nightlySelfReview: { selfReviewProposal: { actions } } },
});

describe('getSelfReviewProposalContent', () => {
  it('reads the full create_skill input', () => {
    const items = getSelfReviewProposalContent(
      withActions([
        {
          actionType: 'create_skill',
          operation: {
            domain: 'skill',
            input: {
              bodyMarkdown: '# Preflight\n\n- Check the cwd',
              description: 'Checks before running commands.',
              name: 'command-preflight',
              title: 'Command Execution Preflight',
              userId: 'user-1',
            },
            operation: 'create',
          },
          rationale: 'Commands kept failing on a wrong cwd.',
        },
      ]),
    );

    expect(items).toEqual([
      {
        bodyMarkdown: '# Preflight\n\n- Check the cwd',
        description: 'Checks before running commands.',
        kind: 'create_skill',
        name: 'command-preflight',
        rationale: 'Commands kept failing on a wrong cwd.',
        title: 'Command Execution Preflight',
      },
    ]);
  });

  it('reads refine_skill, refine_prompt and write_memory content with their targets', () => {
    const items = getSelfReviewProposalContent(
      withActions([
        {
          actionType: 'refine_skill',
          baseSnapshot: { skillName: 'pr-checklist', targetTitle: 'PR checklist' },
          operation: {
            domain: 'skill',
            input: { bodyMarkdown: 'New body', skillDocumentId: 'doc-1', userId: 'u' },
            operation: 'refine',
          },
          rationale: 'Missing steps.',
        },
        {
          actionType: 'refine_prompt',
          operation: {
            domain: 'agent',
            input: { agentId: 'agt', systemRole: 'You are concise.', userId: 'u' },
            operation: 'refine_prompt',
          },
          rationale: 'Too verbose.',
        },
        {
          actionType: 'write_memory',
          operation: {
            domain: 'memory',
            input: { content: 'Prefers pnpm.', userId: 'u' },
            operation: 'write',
          },
          rationale: 'Stated twice.',
        },
      ]),
    );

    expect(items).toEqual([
      {
        bodyMarkdown: 'New body',
        kind: 'refine_skill',
        rationale: 'Missing steps.',
        target: 'PR checklist',
      },
      { kind: 'refine_prompt', rationale: 'Too verbose.', systemRole: 'You are concise.' },
      { kind: 'write_memory', memoryContent: 'Prefers pnpm.', rationale: 'Stated twice.' },
    ]);
  });

  it('skips noop and proposal_only actions and maps unknown types to other', () => {
    const items = getSelfReviewProposalContent(
      withActions([
        { actionType: 'noop' },
        { actionType: 'proposal_only', rationale: 'idea' },
        { actionType: 'future_action', rationale: 'Something new.' },
      ]),
    );

    expect(items).toEqual([{ kind: 'other', rationale: 'Something new.' }]);
  });

  it('tolerates missing or malformed metadata', () => {
    expect(getSelfReviewProposalContent(undefined)).toEqual([]);
    expect(getSelfReviewProposalContent({ agentSignal: 'x' })).toEqual([]);
    expect(
      getSelfReviewProposalContent({
        agentSignal: { nightlySelfReview: { selfReviewProposal: { actions: 'x' } } },
      }),
    ).toEqual([]);
    expect(
      getSelfReviewProposalContent(withActions([{ actionType: 'create_skill', operation: 5 }])),
    ).toEqual([{ kind: 'create_skill' }]);
  });
});

describe('hasSelfReviewProposalContent', () => {
  it('is true only when an item has text beyond the card rows', () => {
    expect(hasSelfReviewProposalContent([])).toBe(false);
    expect(hasSelfReviewProposalContent([{ kind: 'create_skill', rationale: 'why' }])).toBe(false);
    expect(hasSelfReviewProposalContent([{ bodyMarkdown: '# x', kind: 'create_skill' }])).toBe(
      true,
    );
    expect(hasSelfReviewProposalContent([{ kind: 'refine_prompt', systemRole: 'Be brief.' }])).toBe(
      true,
    );
  });
});
