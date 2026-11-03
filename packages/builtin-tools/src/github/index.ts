import { GITHUB_TOOL_NAMES, GitHubInspector } from '@lobechat/shared-tool-ui/inspectors';
import { GitHubRender as SharedGitHubRender } from '@lobechat/shared-tool-ui/renders';
import { type BuiltinInspector, type BuiltinRender } from '@lobechat/types';

import GithubRunCommandInspector from './RunCommandInspector';
import GithubRunCommandRender from './RunCommandRender';

export const GithubIdentifier = 'github';

export const GithubApiName = {
  runCommand: 'runCommand',
} as const;

const GithubToolInspectors = Object.fromEntries(
  GITHUB_TOOL_NAMES.flatMap((name) => [
    [name, GitHubInspector],
    [`github_${name}`, GitHubInspector],
  ]),
) as Record<string, BuiltinInspector>;

const GithubToolRenders = Object.fromEntries(
  GITHUB_TOOL_NAMES.flatMap((name) => [
    [name, SharedGitHubRender],
    [`github_${name}`, SharedGitHubRender],
  ]),
) as Record<string, BuiltinRender>;

// The tool call emits the camelCase `runCommand` apiName, while older payloads
// used the snake_case `run_command`. Register both so the render/inspector match
// regardless of the casing.
export const GithubInspectors: Record<string, BuiltinInspector> = {
  ...GithubToolInspectors,
  runCommand: GithubRunCommandInspector as BuiltinInspector,
  run_command: GithubRunCommandInspector as BuiltinInspector,
};

export const GithubRenders: Record<string, BuiltinRender> = {
  ...GithubToolRenders,
  runCommand: GithubRunCommandRender as BuiltinRender,
  run_command: GithubRunCommandRender as BuiltinRender,
};
