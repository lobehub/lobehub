import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';
import { toResourceMeta } from './helpers';
import agent from './references/agent';
import bot from './references/bot';
import config from './references/config';
import doc from './references/doc';
import eval_ from './references/eval';
import file from './references/file';
import generate from './references/generate';
import kb from './references/kb';
import memory from './references/memory';
import message from './references/message';
import model from './references/model';
import plugin from './references/plugin';
import provider from './references/provider';
import search from './references/search';
import skill from './references/skill';
import topic from './references/topic';

export const LobeHubIdentifier = 'lobehub';

export const LobeHubSkill: BuiltinSkill = {
  content: systemPrompt,
  description:
    'Manage the LobeHub platform via CLI — knowledge bases, memory, agents, files, search, generation, and more.',
  identifier: LobeHubIdentifier,
  name: 'LobeHub',
  resources: toResourceMeta({
    'references/agent': agent,
    'references/bot': bot,
    'references/config': config,
    'references/doc': doc,
    'references/eval': eval_,
    'references/file': file,
    'references/generate': generate,
    'references/kb': kb,
    'references/memory': memory,
    'references/message': message,
    'references/model': model,
    'references/plugin': plugin,
    'references/provider': provider,
    'references/search': search,
    'references/skill': skill,
    'references/topic': topic,
  }),
  source: 'builtin',
};
