import { ConnectorDataError } from '@lobechat/connector-data';
import type { GmailMessage } from '@lobechat/connector-data/gmail';
import type { OnboardingTaskSource } from '@lobechat/types';

import type { GmailTaskRecommendationProviderConfig } from '../config';
import { defaultTaskRecommendationConfig } from '../config';
import type { TaskRecommendationProvider } from '../types';

interface GmailSignal {
  kind: GmailTaskRecommendationProviderConfig['queries'][number]['kind'];
  message: GmailMessage;
}

/** Creates the independent Gmail task recommendation collector. */
export const createGmailTaskRecommendationProvider = (
  config: GmailTaskRecommendationProviderConfig = defaultTaskRecommendationConfig.providers.gmail,
): TaskRecommendationProvider => ({
  id: 'gmail',
  collect: async ({ connectorData }) => {
    const client = await connectorData.getGmailClient();
    const maxResults = Math.max(1, Math.ceil(config.maxSignals / config.queries.length));
    const settled = await Promise.allSettled(
      config.queries.map(({ query }) => client.searchMessages({ maxResults, query })),
    );
    const errors = settled.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            {
              code: 'GMAIL_TASK_SIGNAL_COLLECTION_FAILED',
              message: 'Gmail task signal collection failed',
              operation: config.queries[index].kind,
              provider: 'gmail',
              retryable:
                result.reason instanceof ConnectorDataError ? result.reason.retryable : true,
            },
          ]
        : [],
    );
    const candidates = settled.flatMap((result, index): GmailSignal[] =>
      result.status === 'fulfilled'
        ? result.value.map((message) => ({ kind: config.queries[index].kind, message }))
        : [],
    );
    const signals = [
      ...new Map(
        candidates.map((signal) => [`${signal.kind}:${signal.message.id}`, signal]),
      ).values(),
    ].slice(0, config.maxSignals);
    const context = JSON.stringify({ provider: 'gmail', signals }, null, 2).slice(
      0,
      config.maxContextLength,
    );

    return {
      context,
      diagnostics: {
        errors,
        evidenceCount: signals.length,
        failedCount: errors.length,
        succeededCount: settled.filter(({ status }) => status === 'fulfilled').length,
      },
      signalCount: signals.length,
      sources: [
        ...new Map(
          signals.flatMap(({ message }) => {
            if (!message.sourceUrl) return [];
            const subject = message.subject.trim();
            const source = {
              ...(subject ? { subject: subject.slice(0, 500) } : {}),
              type: 'gmail',
              url: message.sourceUrl,
            } satisfies OnboardingTaskSource;
            return [[message.sourceUrl, source] as const];
          }),
        ).values(),
      ],
    };
  },
});
