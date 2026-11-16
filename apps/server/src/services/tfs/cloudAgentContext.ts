import { isPersistentSandboxMode } from '@lobechat/builtin-tool-cloud-sandbox';
import { parseTfsRepository } from '@lobechat/utils/tfs';

import type { buildCloudHeteroContext } from '@/server/services/heterogeneousAgent/cloudHeteroContext';
import { buildRemoteDeviceHeteroContext } from '@/server/services/heterogeneousAgent/remoteDeviceHeteroContext';

export const usesTfsCloudAgentContext = (
  sources: { url: string }[] | undefined,
  githubRepos: readonly string[],
) =>
  githubRepos.length === 0 &&
  !!sources?.length &&
  sources.every((source) => !!parseTfsRepository(source.url));

/** DevOps cloud runs have their own instructions; GitHub setup is not a prerequisite. */
export const buildTfsCloudAgentContext = (
  params: Parameters<typeof buildCloudHeteroContext>[0],
): string => {
  const persistent = isPersistentSandboxMode(params.sandbox?.mode);
  const workspace = [
    '<tfs_cloud_workspace>',
    `You are running in a cloud sandbox. Working folder: ${JSON.stringify(params.sandbox?.cwd ?? '(sandbox default)')}.`,
    persistent
      ? 'Files in this working folder persist; packages installed on the sandbox machine may need reinstalling in a later session.'
      : 'This is a temporary sandbox. Files may be lost when the session expires; tell the user how to preserve requested results.',
    'The selected TFS environment initializes code before this CLI starts. Inspect the folder and git remote to confirm initialization succeeded. If code is missing, report the initialization or personal authorization problem; do not invent a successful checkout.',
    'Use the TFS repository URLs and branches in tfs_repositories. GitHub repository selection, gh login and GITHUB_TOKEN do not authenticate TFS.',
    'Personal server credentials are removed before this agent starts. For authenticated network Git operations in this cloud folder use lh tfs git fetch|pull|push --source <sourceIndex> --branch <branch>. It is bound to this active operation and selected environment, uses the caller personal binding and never returns credentials. Pull is fast-forward only and push never forces. Local commits use normal git. Never ask for passwords or PATs in chat.',
    'Commit, push, create branches or change remotes only as required by the user task. Do not turn a TFS task into a GitHub fork or pull-request workflow.',
    '</tfs_cloud_workspace>',
  ].join('\n');
  return buildRemoteDeviceHeteroContext({
    agentSystemContext: [params.agentSystemContext, workspace].filter(Boolean).join('\n\n'),
    conversationHistory: params.conversationHistory,
    unansweredUserTurns: params.unansweredUserTurns,
  })!;
};
