import { type BuiltinInspector, type BuiltinRender } from '@lobechat/types';

import GithubRunCommandInspector from './RunCommandInspector';
import GithubRunCommandRender from './RunCommandRender';

export const GithubIdentifier = 'github';

export const GithubApiName = {
  runCommand: 'run_command',
} as const;

export const GithubInspectors: Record<string, BuiltinInspector> = {
  [GithubApiName.runCommand]: GithubRunCommandInspector as BuiltinInspector,
};

export const GithubRenders: Record<string, BuiltinRender> = {
  [GithubApiName.runCommand]: GithubRunCommandRender as BuiltinRender,
};
