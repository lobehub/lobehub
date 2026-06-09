// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createSelfReviewBriefText, type SelfReviewBriefTextTranslator } from '../briefText';

const zhCN: Record<string, string> = {
  'brief.agentSignal.selfReview.applied.heading': '已更新',
  'brief.agentSignal.selfReview.applied.summary': '已应用 {{count}} 条夜间回顾更新。',
  'brief.agentSignal.selfReview.applied.summary_plural': '已应用 {{count}} 条夜间回顾更新。',
  'brief.agentSignal.selfReview.applied.title': '夜间回顾已更新资源',
  'brief.agentSignal.selfReview.error.heading': '问题',
  'brief.agentSignal.selfReview.error.summary': '部分夜间回顾内容未能完成。',
  'brief.agentSignal.selfReview.error.title': '夜间回顾遇到了问题',
  'brief.agentSignal.selfReview.ideas.summary': '已保存夜间回顾记录，供后续查看。',
  'brief.agentSignal.selfReview.ideas.title': '夜间回顾记录',
  'brief.agentSignal.selfReview.proposal.heading': '建议',
  'brief.agentSignal.selfReview.proposal.summary': '有 {{count}} 条夜间回顾建议需要你确认。',
  'brief.agentSignal.selfReview.proposal.summary_plural': '有 {{count}} 条夜间回顾建议需要你确认。',
  'brief.agentSignal.selfReview.proposal.title': '有夜间回顾建议需要确认',
};

const createTranslator =
  (resources: Record<string, string>): SelfReviewBriefTextTranslator =>
  (key, options = {}) =>
    Object.entries(options).reduce(
      (content, [name, value]) => content.replace(`{{${name}}}`, value),
      resources[key] ?? key,
    );

describe('agent signal self-review brief text', () => {
  /**
   * @example
   * Proposal outcomes produce default English decision text with action details.
   */
  it('renders default English proposal text with proposal details', () => {
    expect(
      createSelfReviewBriefText({
        actionCounts: { applied: 0, failed: 0, proposed: 2, skipped: 1 },
        actionSummaries: {
          applied: [],
          failed: [],
          proposed: ['Review skill consolidation proposal.', 'Review PR checklist refinement.'],
        },
        outcome: 'proposal',
      }),
    ).toEqual({
      priority: 'normal',
      summary:
        '2 dream suggestions need your review.\n\n**Suggestion**\n- Review skill consolidation proposal.\n- Review PR checklist refinement.',
      title: 'Dream suggestion needs review',
      type: 'decision',
    });
  });

  /**
   * @example
   * Persisted Brief shell text uses the supplied server translator.
   */
  it('renders proposal text through the supplied translator', () => {
    expect(
      createSelfReviewBriefText({
        actionCounts: { applied: 0, failed: 0, proposed: 1, skipped: 0 },
        actionSummaries: { applied: [], failed: [], proposed: ['检查技能合并建议。'] },
        outcome: 'proposal',
        t: createTranslator(zhCN),
      }),
    ).toEqual({
      priority: 'normal',
      summary: '有 1 条夜间回顾建议需要你确认。\n\n**建议**\n- 检查技能合并建议。',
      title: '有夜间回顾建议需要确认',
      type: 'decision',
    });
  });

  /**
   * @example
   * Without a translator the helper falls back to default English locale resources.
   */
  it('falls back to default English resources', () => {
    expect(
      createSelfReviewBriefText({
        actionCounts: { applied: 1, failed: 0, proposed: 0, skipped: 0 },
        actionSummaries: {
          applied: ['Saved concise PR summary preference.'],
          failed: [],
          proposed: [],
        },
        outcome: 'applied',
      }).title,
    ).toBe('Dream updated resources');
  });
});
