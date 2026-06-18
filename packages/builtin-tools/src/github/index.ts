import { type BuiltinInspector, type BuiltinRender } from '@lobechat/types';

import GithubRunCommandInspector from './RunCommandInspector';
import GithubRunCommandRender from './RunCommandRender';

export const GithubIdentifier = 'github';

export const GithubApiName = {
  runCommand: 'runCommand',
} as const;

// The tool call emits the camelCase `runCommand` apiName, while older payloads
// used the snake_case `run_command`. Register both so the render/inspector match
// regardless of the casing.
export const GithubInspectors: Record<string, BuiltinInspector> = {
  runCommand: GithubRunCommandInspector as BuiltinInspector,
  run_command: GithubRunCommandInspector as BuiltinInspector,
};

export const GithubRenders: Record<string, BuiltinRender> = {
  runCommand: GithubRunCommandRender as BuiltinRender,
  run_command: GithubRunCommandRender as BuiltinRender,
};
