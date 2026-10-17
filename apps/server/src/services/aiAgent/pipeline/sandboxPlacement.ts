import type { InitialTopicMetadata } from '@lobechat/types';

/**
 * The cloud-sandbox placement a first send carries onto the topic it creates —
 * an environment directory or a folder, on one of the workspace's drives — without the keys it
 * does not set, so an unset one never lands on the row as an explicit blank.
 */
export const pickSandboxPlacement = (
  metadata?: Pick<
    InitialTopicMetadata,
    'sandboxDrive' | 'sandboxInstanceId' | 'sandboxWorkingDirectory'
  >,
) => ({
  ...(metadata?.sandboxDrive && { sandboxDrive: metadata.sandboxDrive }),
  ...(metadata?.sandboxInstanceId && { sandboxInstanceId: metadata.sandboxInstanceId }),
  ...(metadata?.sandboxWorkingDirectory && {
    sandboxWorkingDirectory: metadata.sandboxWorkingDirectory,
  }),
});
