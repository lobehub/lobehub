import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';

export const AgentBrowserIdentifier = 'lobe-agent-browser';

export const AgentBrowserSkill: BuiltinSkill = {
  content: systemPrompt,
  description:
    'Automate web browsers and Electron desktop apps — navigate pages, fill forms, click buttons, take screenshots, and extract data using agent-browser CLI',
  identifier: AgentBrowserIdentifier,
  name: 'Agent Browser',
  source: 'builtin',
};
