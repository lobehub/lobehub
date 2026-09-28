import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';
import { AgentBrowserIdentifier, AgentBrowserManifest } from './manifest';

export { AgentBrowserIdentifier };

export const AgentBrowserSkill: BuiltinSkill = {
  ...AgentBrowserManifest,
  content: systemPrompt,
};
