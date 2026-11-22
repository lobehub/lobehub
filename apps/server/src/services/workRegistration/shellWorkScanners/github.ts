import type { ShellWorkScanner } from './types';

/**
 * github issue/PR Works from `gh issue|pr create/edit` runs — plus, under the
 * Better Coding Experience lab, numbered `gh pr ready|merge` runs. Parsing reuses
 * the github skill's gh-CLI normalizer (via
 * `workModel.registerShellGithubResult` → `normalizeGithubShellToolResult`),
 * so identity lands on the same `owner/repo#number` Work row as
 * skill-registered versions.
 */
export const githubShellWorkScanner: ShellWorkScanner = {
  matches: (command) => command.includes('gh '),
  name: 'github',
  register: async ({ pullRequestLinking, transcript: _transcript, workModel, ...input }) => {
    if (!pullRequestLinking) return workModel.registerShellGithubResult(input);

    // A bare `gh pr ready|merge <n>` names no repository; the topic's own
    // pull requests are the only safe place to look it up.
    const needsTopic = /\bgh\s+pr\s+(?:ready|merge)\b/.test(input.data.command);
    return workModel.registerShellGithubResult(input, {
      pullRequestLifecycle: true,
      topicPullRequests: needsTopic ? await pullRequestLinking.listTopicPullRequestIds() : [],
    });
  },
};
