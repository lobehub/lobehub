/**
 * Group async-task result helpers, extracted from
 * `createGroupOrchestrationExecutors` — that file is over the 800-line limit
 * (AGENTS.md source-layout rule) and must not grow, so these pure functions
 * live in their own module.
 */

export interface GroupAsyncTaskResultContentItem {
  agentId: string;
  error?: string;
  result?: string;
  success: boolean;
  title?: string;
}

export const formatGroupAsyncTaskResultContent = (items: GroupAsyncTaskResultContentItem[]) =>
  items
    .map((item, index) => {
      const title = item.title ?? item.agentId;
      const content = item.success
        ? (item.result ?? 'Completed successfully.')
        : `Failed: ${item.error ?? 'Unknown error'}`;

      return `${index + 1}. ${title}\n${content}`;
    })
    .join('\n\n');

export const toGroupAsyncTaskResultPayload = ({
  agentId,
  error,
  result,
  success,
}: GroupAsyncTaskResultContentItem) => ({
  agentId,
  ...(error === undefined ? {} : { error }),
  ...(result === undefined ? {} : { result }),
  success,
});
