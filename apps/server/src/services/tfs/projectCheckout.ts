import { projectCheckoutDirectory } from '@lobechat/builtin-tool-cloud-sandbox';
import type { ChatTopicMetadata } from '@lobechat/types';
import { hasTfsGitSource } from '@lobechat/utils/tfs';

/** Repair only automatic project checkouts; never relocate a user-chosen shared folder. */
export const isPersonalTfsProjectCheckout = (
  topic: { metadata?: ChatTopicMetadata | null; projectId?: string | null },
  configuration?: Parameters<typeof hasTfsGitSource>[0],
) => {
  const { sandboxEnvironmentId, sandboxInstanceId, sandboxWorkingDirectory } = topic.metadata ?? {};
  return !!(
    topic.projectId &&
    sandboxEnvironmentId &&
    !sandboxInstanceId &&
    sandboxWorkingDirectory === projectCheckoutDirectory(topic.projectId, sandboxEnvironmentId) &&
    hasTfsGitSource(configuration)
  );
};
