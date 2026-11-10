import type { InitialTopicMetadata } from '@lobechat/types';

/**
 * The cloud-sandbox placement a first send carries onto the topic it creates —
 * a folder on one of the workspace's drives and the environment to initialize
 * it from — without the keys it does not set, so an unset one never lands on the row as an explicit blank.
 */
export const pickSandboxPlacement = (
  metadata?: Pick<
    InitialTopicMetadata,
    'sandboxDrive' | 'sandboxEnvironmentId' | 'sandboxInstanceId' | 'sandboxWorkingDirectory'
  >,
) => ({
  ...(metadata?.sandboxDrive && { sandboxDrive: metadata.sandboxDrive }),
  ...(metadata?.sandboxEnvironmentId && { sandboxEnvironmentId: metadata.sandboxEnvironmentId }),
  ...(metadata?.sandboxInstanceId && { sandboxInstanceId: metadata.sandboxInstanceId }),
  ...(metadata?.sandboxWorkingDirectory && {
    sandboxWorkingDirectory: metadata.sandboxWorkingDirectory,
  }),
});
