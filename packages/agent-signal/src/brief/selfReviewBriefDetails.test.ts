import { describe, expect, it } from 'vitest';

import {
  formatSelfReviewBriefSummary,
  formatSelfReviewBriefTitle,
  getSelfReviewBriefDetails,
  type SelfReviewBriefDetailsTranslator,
} from './selfReviewBriefDetails';

const en: Record<string, string> = {
  'brief.agentSignal.selfReview.kind.create_skill.plain': 'New skill',
  'brief.agentSignal.selfReview.kind.create_skill.withTarget': 'New skill: {{target}}',
  'brief.agentSignal.selfReview.kind.idea.plain': 'Dream note',
  'brief.agentSignal.selfReview.kind.idea.withTarget': 'Dream note: {{target}}',
  'brief.agentSignal.selfReview.kind.refine_prompt.plain': 'Refine system prompt',
  'brief.agentSignal.selfReview.kind.refine_skill.withTarget': 'Refine skill: {{target}}',
  'brief.agentSignal.selfReview.list.more': '{{count}} more',
  'brief.agentSignal.selfReview.title.more': '{{title}} (+{{count}} more)',
};

const t: SelfReviewBriefDetailsTranslator = (key, options = {}) =>
  Object.entries(options).reduce(
    (content, [name, value]) => content.replace(`{{${name}}}`, value),
    en[key] ?? key,
  );

const createSkillAction = {
  actionType: 'create_skill',
  baseSnapshot: { absent: true, skillName: 'pr-checklist', targetType: 'skill' },
  evidenceRefs: [],
  idempotencyKey: 'a1',
  operation: {
    domain: 'skill',
    input: {
      bodyMarkdown: '# PR checklist',
      description: 'Checklist for reviewing pull requests.',
      name: 'pr-checklist',
      title: 'PR checklist',
    },
    operation: 'create',
  },
  rationale: 'The user asked for the same PR review steps three times.',
  risk: 'low',
  target: { skillName: 'pr-checklist' },
};

const proposalMetadata = (actions: unknown[], summary?: string) => ({
  agentSignal: {
    nightlySelfReview: {
      outcome: 'proposal',
      selfReviewProposal: { actions, status: 'pending', ...(summary ? { summary } : {}) },
    },
  },
});

describe('selfReviewBriefDetails', () => {
  it('names a single create_skill proposal by its skill title', () => {
    const details = getSelfReviewBriefDetails(
      proposalMetadata([createSkillAction], 'Save the PR review steps as a skill.'),
    );

    expect(details).toEqual({
      items: [
        {
          description: 'The user asked for the same PR review steps three times.',
          kind: 'create_skill',
          target: 'PR checklist',
        },
      ],
      kind: 'proposal',
      summary: 'Save the PR review steps as a skill.',
    });
    expect(formatSelfReviewBriefTitle(details!, t)).toBe('New skill: PR checklist');
    expect(formatSelfReviewBriefSummary(details!, t)).toBe('Save the PR review steps as a skill.');
  });

  it('falls back to the rationale when the proposal has no summary', () => {
    const details = getSelfReviewBriefDetails(proposalMetadata([createSkillAction]));

    expect(formatSelfReviewBriefSummary(details!, t)).toBe(
      'The user asked for the same PR review steps three times.',
    );
  });

  it('lists every action of a multi-action proposal', () => {
    const details = getSelfReviewBriefDetails(
      proposalMetadata([
        createSkillAction,
        {
          actionType: 'refine_skill',
          baseSnapshot: { targetTitle: 'Release notes' },
          rationale: 'Release notes keep missing the migration section.',
        },
        { actionType: 'refine_prompt', rationale: 'Answer in the user language.' },
        { actionType: 'noop', rationale: 'Nothing to do.' },
      ]),
    );

    expect(details?.items.map((item) => item.kind)).toEqual([
      'create_skill',
      'refine_skill',
      'refine_prompt',
    ]);
    expect(formatSelfReviewBriefTitle(details!, t)).toBe('New skill: PR checklist (+2 more)');
    expect(formatSelfReviewBriefSummary(details!, t)).toBe(
      [
        '- **New skill: PR checklist** — The user asked for the same PR review steps three times.',
        '- **Refine skill: Release notes** — Release notes keep missing the migration section.',
        '- **Refine system prompt** — Answer in the user language.',
      ].join('\n'),
    );
  });

  it('caps the persisted list and counts the rest', () => {
    const actions = Array.from({ length: 7 }, (_, index) => ({
      ...createSkillAction,
      operation: { ...createSkillAction.operation, input: { title: `Skill ${index + 1}` } },
    }));
    const summary = formatSelfReviewBriefSummary(
      getSelfReviewBriefDetails(proposalMetadata(actions))!,
      t,
    );

    expect(summary.split('\n')).toHaveLength(6);
    expect(summary).toContain('- **New skill: Skill 5**');
    expect(summary).not.toContain('Skill 6');
    expect(summary.endsWith('- 2 more')).toBe(true);
  });

  it('lists ideas of an ideas-only brief', () => {
    const details = getSelfReviewBriefDetails({
      agentSignal: {
        nightlySelfReview: {
          ideas: [
            { rationale: 'Users often ask for weekly summaries.', title: 'Weekly digest' },
            { rationale: 'A deploy checklist could prevent rollbacks.' },
          ],
          outcome: 'ideas',
        },
      },
    });

    expect(details?.kind).toBe('ideas');
    expect(formatSelfReviewBriefTitle(details!, t)).toBe('Dream note: Weekly digest (+1 more)');
    expect(formatSelfReviewBriefSummary(details!, t)).toBe(
      [
        '- **Dream note: Weekly digest** — Users often ask for weekly summaries.',
        '- **Dream note: A deploy checklist could prevent rollbacks.**',
      ].join('\n'),
    );
  });

  it('returns undefined for briefs without proposal actions or ideas', () => {
    expect(getSelfReviewBriefDetails(undefined)).toBeUndefined();
    expect(getSelfReviewBriefDetails({ goal: { goalId: 'g' } })).toBeUndefined();
    expect(
      getSelfReviewBriefDetails(proposalMetadata([{ actionType: 'noop', rationale: 'x' }])),
    ).toBeUndefined();
  });
});
