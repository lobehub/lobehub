import type { ShellWorkScanner } from './types';

/**
 * github issue/PR Works from `gh issue|pr create/edit` runs. Parsing reuses
 * the github skill's gh-CLI normalizer (via
 * `workModel.registerShellGithubResult` → `normalizeGithubShellToolResult`),
 * so identity lands on the same `owner/repo#number` Work row as
 * skill-registered versions.
 */
export const githubShellWorkScanner: ShellWorkScanner = {
  matches: (command) => command.includes('gh '),
  name: 'github',
  register: ({ workModel, ...input }) => workModel.registerShellGithubResult(input),
};
