import { type BuiltinInspector, type BuiltinRender } from '@lobechat/types';

import GithubRunCommandInspector from './RunCommandInspector';
import GithubRunCommandRender from './RunCommandRender';

export const GithubIdentifier = 'github';

export const GithubApiName = {
  runCommand: 'runCommand',
} as const;

export const GithubInspectors: Record<string, BuiltinInspector> = {
  runCommand: GithubRunCommandInspector as BuiltinInspector,
  run_command: GithubRunCommandInspector as BuiltinInspector,
};

export const GithubRenders: Record<string, BuiltinRender> = {
  runCommand: GithubRunCommandRender as BuiltinRender,
  run_command: GithubRunCommandRender as BuiltinRender,
};