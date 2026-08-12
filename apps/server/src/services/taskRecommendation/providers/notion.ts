import { ConnectorDataError } from '@lobechat/connector-data';
import type { NotionItem } from '@lobechat/connector-data/notion';
import { DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG } from '@lobechat/prompts';
import type { OnboardingTaskSource } from '@lobechat/types';

import type { NotionTaskRecommendationProviderConfig } from '../config';
import type { TaskRecommendationProvider } from '../types';

interface NotionSignal {
  excerpt?: string;
  kind: 'follow_up_notes' | 'open_action_items' | 'stale_page_review';
  lastEditedAt?: string;
  openTaskCount?: number;
  sourceUrl: string;
  title: string;
}

const MAX_EXCERPT_LENGTH = 6000;
const MAX_WORKSPACE_ITEMS = 50;
const UNCHECKED_TASK_PATTERN = /^[\t ]*[-*][\t ]+\[[\t ]\][\t ]+/gm;
const FOLLOW_UP_PATTERN = /\b(?:TODO|TBD|FIXME|follow[- ]?up|next steps?)\b/i;

const editTime = ({ lastEditedAt }: NotionItem): number => {
  if (!lastEditedAt) return 0;
  const milliseconds = new Date(lastEditedAt).getTime();
  return Number.isFinite(milliseconds) ? milliseconds : 0;
};

const staleBefore = (days: number): number =>
  // Convert the product-facing day threshold to milliseconds before comparing Notion timestamps.
  Date.now() - days * 24 * 60 * 60 * 1000;

const contentSignal = (item: NotionItem, markdown: string): NotionSignal | undefined => {
  const uncheckedTasks = markdown.match(UNCHECKED_TASK_PATTERN) ?? [];
  if (uncheckedTasks.length > 0) {
    return {
      excerpt: markdown.slice(0, MAX_EXCERPT_LENGTH),
      kind: 'open_action_items',
      lastEditedAt: item.lastEditedAt,
      openTaskCount: uncheckedTasks.length,
      sourceUrl: item.sourceUrl,
      title: item.title,
    };
  }
  if (FOLLOW_UP_PATTERN.test(markdown)) {
    return {
      excerpt: markdown.slice(0, MAX_EXCERPT_LENGTH),
      kind: 'follow_up_notes',
      lastEditedAt: item.lastEditedAt,
      sourceUrl: item.sourceUrl,
      title: item.title,
    };
  }
};

/**
 * Creates the independent Notion task recommendation collector.
 *
 * Use when:
 * - The onboarding task workflow needs actionable signals from connected Notion pages
 * - Tests or product tuning need to inject a bounded Notion collection policy
 *
 * Expects:
 * - A read-only Notion connector available through Connector Data
 * - Prompt examples and principles that preserve external side-effect boundaries
 *
 * Returns:
 * - A registry-ready provider that emits grounded page URLs and bounded evidence
 */
export const createNotionTaskRecommendationProvider = (
  config: NotionTaskRecommendationProviderConfig = {
    ...DEFAULT_ONBOARDING_TASK_RECOMMENDATION_PROMPT_CONFIG.providers.notion,
    maxContentPages: 12,
    maxContextLength: 24_000,
    maxSignals: 24,
    staleAfterDays: 180,
    staleItemRatioThreshold: 0.9,
  },
): TaskRecommendationProvider => ({
  id: 'notion',
  guide: { examples: config.examples, principles: config.principles },
  collect: async ({ connectorData }) => {
    const client = await connectorData.getNotionClient();
    const items = await client.listItems({ maxResults: MAX_WORKSPACE_ITEMS });
    const freshnessCutoff = staleBefore(config.staleAfterDays);
    const itemEditTimes = items.map(editTime);
    const staleItemCount = itemEditTimes.filter(
      (milliseconds) => milliseconds > 0 && milliseconds < freshnessCutoff,
    ).length;
    const unknownItemCount = itemEditTimes.filter((milliseconds) => milliseconds === 0).length;
    const recentItemCount = itemEditTimes.length - staleItemCount - unknownItemCount;
    // Clamp the injectable ratio so a configuration mistake cannot make every scan stale-dominant.
    const staleItemRatioThreshold = Math.min(1, Math.max(0, config.staleItemRatioThreshold));
    const staleItemRatio = itemEditTimes.length > 0 ? staleItemCount / itemEditTimes.length : 0;
    const isStaleDominant =
      itemEditTimes.length > 0 &&
      unknownItemCount === 0 &&
      staleItemRatio >= staleItemRatioThreshold;
    const latestItem = items.toSorted(
      (left, right) => editTime(right) - editTime(left) || left.id.localeCompare(right.id),
    )[0];
    const freshness = {
      itemCount: items.length,
      ...(latestItem?.lastEditedAt ? { latestEditedAt: latestItem.lastEditedAt } : {}),
      mode: isStaleDominant ? ('stale_dominant' as const) : ('mixed_or_current' as const),
      recentItemCount,
      scanLimit: MAX_WORKSPACE_ITEMS,
      staleAfterDays: config.staleAfterDays,
      staleItemCount,
      staleItemRatio,
      staleItemRatioThreshold,
      unknownItemCount,
    };
    const contentCandidates = items
      .filter(({ kind }) => kind === 'page')
      .toSorted(
        (left, right) => editTime(right) - editTime(left) || left.id.localeCompare(right.id),
      )
      .slice(0, config.maxContentPages);
    const settledContent = await Promise.allSettled(
      contentCandidates.map(({ id }) => client.getPageMarkdown(id)),
    );
    const errors = settledContent.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              code: 'NOTION_TASK_CONTENT_COLLECTION_FAILED',
              message: 'Notion task signal collection failed',
              operation: `page_content_${index}`,
              provider: 'notion',
              retryable:
                result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
            },
          ]
        : [],
    );
    const actionableSignals = settledContent.flatMap((result, index): NotionSignal[] => {
      if (result.status !== 'fulfilled' || !result.value) return [];
      const signal = contentSignal(contentCandidates[index], result.value);
      return signal ? [signal] : [];
    });
    const actionableUrls = new Set(actionableSignals.map(({ sourceUrl }) => sourceUrl));
    const maintenanceSignals = items.flatMap((item): NotionSignal[] => {
      if (
        actionableUrls.has(item.sourceUrl) ||
        !item.lastEditedAt ||
        editTime(item) >= freshnessCutoff
      ) {
        return [];
      }
      return [
        {
          kind: 'stale_page_review',
          lastEditedAt: item.lastEditedAt,
          sourceUrl: item.sourceUrl,
          title: item.title,
        },
      ];
    });
    const signals = [...actionableSignals, ...maintenanceSignals].slice(0, config.maxSignals);
    const sources = [
      ...new Map(
        signals.map((signal) => [
          signal.sourceUrl,
          {
            title: signal.title.slice(0, 500),
            type: 'notion',
            url: signal.sourceUrl,
          } satisfies OnboardingTaskSource,
        ]),
      ).values(),
    ];

    const promptPrinciples = isStaleDominant
      ? [
          `Freshness assessment: ${staleItemCount} of ${items.length} Notion items returned by the current bounded connector scan have valid edit dates older than ${config.staleAfterDays} days; ${recentItemCount} are newer, none have unknown dates, and the latest visible edit is ${latestItem?.lastEditedAt}. The stale share ${staleItemRatio.toFixed(3)} meets the configured ${staleItemRatioThreshold.toFixed(3)} stale-dominance threshold.`,
          ...config.staleWorkspacePrinciples,
        ]
      : undefined;

    return {
      context: JSON.stringify({ freshness, provider: 'notion', signals }, null, 2).slice(
        0,
        config.maxContextLength,
      ),
      diagnostics: {
        errors,
        evidenceCount: signals.length,
        failedCount: errors.length,
        succeededCount: 1 + settledContent.filter(({ status }) => status === 'fulfilled').length,
      },
      ...(promptPrinciples ? { promptPrinciples, recommendationLimit: 1 } : {}),
      signalCount: signals.length,
      sources,
    };
  },
});
