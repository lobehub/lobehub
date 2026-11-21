import { parseGitPushResult } from '@/database/models/work';

import type { ShellWorkScanner } from './types';

/**
 * A `git push` to a branch that already has an open pull request links that
 * pull request to the topic (Better Coding Experience only). The branch and
 * repository come from git's own push report; which pull request the branch
 * heads comes from the GitHub App's rows — never from the agent's text — so a
 * push links nothing in a repository no installation tracks (the client's
 * device lookup covers that case through `work.linkPushedPullRequests`).
 */
export const githubPushShellWorkScanner: ShellWorkScanner = {
  matches: (command) => command.includes('git') && command.includes('push'),
  name: 'github-push',
  register: async (input) => {
    if (!input.pullRequestLinking) return null;

    const push = parseGitPushResult({ command: input.data.command, output: input.transcript });
    if (!push) return null;

    const pullRequests = await input.pullRequestLinking.findOpenPullRequestsByHead(
      push.repoFullName,
      push.branches,
    );
    if (pullRequests.length === 0) return null;

    const works = [];
    for (const pullRequest of pullRequests) {
      const identifier = `${pullRequest.repoFullName}#${pullRequest.number}`;
      works.push(
        await input.workModel.registerExternal({
          agentId: input.agentId,
          changeType: 'updated',
          cumulativeCost: input.cumulativeCost,
          cumulativeUsage: input.cumulativeUsage,
          identifier,
          messageId: input.messageId,
          metadata: {
            ...(pullRequest.headRef ? { headBranch: pullRequest.headRef } : {}),
            pullRequestLink: 'push',
          },
          patchFields: pullRequest.title ? ['identifier', 'title', 'url'] : ['identifier', 'url'],
          resourceId: identifier,
          resourceType: 'github_pull_request',
          rootOperationId: input.rootOperationId,
          threadId: input.threadId,
          title: pullRequest.title,
          toolCallId: input.toolCallId,
          toolIdentifier: input.toolIdentifier,
          toolName: input.toolName,
          topicId: input.topicId,
          url: pullRequest.url,
        }),
      );
    }
    return works;
  },
  requiresPullRequestLinking: true,
};
