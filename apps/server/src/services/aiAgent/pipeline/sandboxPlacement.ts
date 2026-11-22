import type { InitialTopicMetadata } from '@lobechat/types';

/**
 * The cloud-sandbox placement a first send carries onto the topic it creates —
 * a folder on one of the workspace's drives and the environment to initialize
 * it from — without the keys it does not set, so an unset one never lands on the row as an explicit blank.
 *
 * Its creation-time markers ride along: whether the placement is a default
 * nobody picked (`sandboxSeeded`) or a temporary sandbox picked on purpose
 * (`sandboxTemporary`). A project conversation reads them to decide whether
 * its environment applies (see `withProjectSandbox`, which drops them before
 * the row is written); without them a default reads as a pick, and a pick of
 * no environment as nothing picked.
 */
export const pickSandboxPlacement = (
  metadata?: Pick<
    InitialTopicMetadata,
    | 'sandboxDrive'
    | 'sandboxEnvironmentId'
    | 'sandboxInstanceId'
    | 'sandboxSeeded'
    | 'sandboxTemporary'
    | 'sandboxWorkingDirectory'
  >,
) => ({
  ...(metadata?.sandboxDrive && { sandboxDrive: metadata.sandboxDrive }),
  ...(metadata?.sandboxEnvironmentId && { sandboxEnvironmentId: metadata.sandboxEnvironmentId }),
  ...(metadata?.sandboxInstanceId && { sandboxInstanceId: metadata.sandboxInstanceId }),
  ...(metadata?.sandboxWorkingDirectory && {
    sandboxWorkingDirectory: metadata.sandboxWorkingDirectory,
  }),
  ...(metadata?.sandboxSeeded && { sandboxSeeded: true }),
  ...(metadata?.sandboxTemporary && { sandboxTemporary: true }),
});
