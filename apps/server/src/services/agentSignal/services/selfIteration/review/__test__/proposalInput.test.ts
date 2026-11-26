// @vitest-environment node
import { describe, expect, it } from 'vitest';

import type { CreateSelfReviewProposalInput } from '../../tools/shared';
import { normalizeSelfReviewProposalInput } from '../proposalInput';

const createSkillAction = (name: string) => ({
  actionType: 'create_skill',
  operation: {
    domain: 'skill',
    input: { bodyMarkdown: `# ${name}`, name, title: name },
    operation: 'create',
  },
  rationale: `Reusable ${name} workflow.`,
  target: { skillName: name },
});

const proposalInput = (actions: unknown): CreateSelfReviewProposalInput =>
  ({
    actions,
    idempotencyKey: 'proposal-1',
    proposalKey: 'skill:proposal-1',
    summary: 'Proposal summary.',
    userId: 'user-1',
  }) as CreateSelfReviewProposalInput;

const errorOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }

  throw new Error('expected normalizeSelfReviewProposalInput to throw');
};

describe('normalizeSelfReviewProposalInput', () => {
  it.each([1, 2, 3])('keeps all %i valid actions in order', (count) => {
    const actions = Array.from({ length: count }, (_, index) =>
      createSkillAction(`skill-${index}`),
    );

    const result = normalizeSelfReviewProposalInput(proposalInput(actions));

    expect(result.actions).toHaveLength(count);
    expect(result.actions).toEqual(actions);
  });

  it('maps `type` and the legacy `record_idea` kind onto actionType', () => {
    const result = normalizeSelfReviewProposalInput(
      proposalInput([
        { target: { skillName: 'a' }, type: 'create_skill' },
        { rationale: 'Just an idea.', type: 'record_idea' },
      ]),
    );

    expect(result.actions).toEqual([
      { actionType: 'create_skill', target: { skillName: 'a' }, type: 'create_skill' },
      { actionType: 'proposal_only', rationale: 'Just an idea.', type: 'record_idea' },
    ]);
  });

  it('wraps a single action object sent instead of a one-element array', () => {
    const action = createSkillAction('solo');

    const result = normalizeSelfReviewProposalInput(proposalInput(action));

    expect(result.actions).toEqual([action]);
  });

  it('decodes actions sent as a JSON-encoded string', () => {
    const actions = [createSkillAction('a'), createSkillAction('b')];

    expect(
      normalizeSelfReviewProposalInput(proposalInput(JSON.stringify(actions))).actions,
    ).toEqual(actions);
    expect(
      normalizeSelfReviewProposalInput(proposalInput(JSON.stringify(actions[0]))).actions,
    ).toEqual([actions[0]]);
  });

  it('leaves a missing actions field to the at-least-one-action check', () => {
    const input = proposalInput(undefined);

    expect(normalizeSelfReviewProposalInput(input)).toBe(input);
  });

  /**
   * @example
   * Production shape behind the "phantom actions[1]" vents: the model closed its
   * one action object early, so the remaining keys spilled into the array as bare
   * strings and the top-level fields went missing.
   */
  it('names the stray value and the missing top-level fields for a spilled single action', () => {
    const message = errorOf(() =>
      normalizeSelfReviewProposalInput({
        actions: [
          createSkillAction('testing'),
          'rationalearization?',
          'rationale?',
          'evidenceRefs?',
          'summary?',
          'proposalKey?',
          'idempotencyKey?',
          'metadata?',
        ],
        userId: 'user-1',
      } as CreateSelfReviewProposalInput),
    );

    expect(message).toContain('Received actions with 8 item(s) (1 object(s))');
    expect(message).toContain(
      'actions[1] is the string "rationalearization?", not an action object',
    );
    expect(message).toContain('actions[5] is the string "proposalKey?"');
    expect(message).toContain('and 2 more');
    expect(message).not.toContain('actions[6]');
    expect(message).toContain('stray values after an action object');
    expect(message).toContain(
      'Top-level fields idempotencyKey, proposalKey, summary are missing; they belong beside actions',
    );
    expect(message).not.toContain('actions[0]');
  });

  it.each([
    {
      actions: [{ target: { skillName: 'x' } }],
      expected: 'actions[0] has no actionType (keys: target)',
    },
    {
      actions: [createSkillAction('a'), { operation: { domain: 'skill' }, rationale: 'r' }],
      expected: 'actions[1] has no actionType (keys: operation, rationale)',
    },
    {
      actions: [createSkillAction('a'), createSkillAction('b'), { actionType: 'rewrite_skill' }],
      expected: 'actions[2] has unsupported actionType "rewrite_skill"',
    },
    {
      actions: [createSkillAction('a'), null, createSkillAction('c')],
      expected: 'actions[1] is null, not an action object',
    },
  ])('points at the real index and field: $expected', ({ actions, expected }) => {
    const message = errorOf(() => normalizeSelfReviewProposalInput(proposalInput(actions)));

    expect(message).toContain(`Received actions with ${actions.length} item(s)`);
    expect(message).toContain(expected);
    expect(message).toContain('expected one of: create_skill, refine_skill');
    expect(message).not.toContain('Top-level fields');
  });

  it('lists every invalid index, not only the first', () => {
    const message = errorOf(() =>
      normalizeSelfReviewProposalInput(
        proposalInput([{ rationale: 'a' }, createSkillAction('b'), { actionType: 'nope' }]),
      ),
    );

    expect(message).toContain('actions[0] has no actionType (keys: rationale)');
    expect(message).toContain('actions[2] has unsupported actionType "nope"');
    expect(message).not.toContain('actions[1]');
  });

  it.each([
    { actions: 'refine the testing skill', expected: 'the string "refine the testing skill"' },
    { actions: { skillName: 'x' }, expected: 'an object with keys skillName' },
    { actions: 3, expected: 'the number 3' },
  ])('rejects a non-array actions value: $expected', ({ actions, expected }) => {
    expect(() => normalizeSelfReviewProposalInput(proposalInput(actions))).toThrow(
      `actions must be an array of action objects, but received ${expected}.`,
    );
  });
});
