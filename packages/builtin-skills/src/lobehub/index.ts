import { type BuiltinSkill } from '@lobechat/types';

import { systemPrompt } from './content';
import { toResourceMeta } from './helpers';
import { LobeHubIdentifier, LobeHubManifest } from './manifest';
import agent from './references/agent';
import agentGroup from './references/agent-group';
import { artifact } from './references/artifact';
import bot from './references/bot';
import botDiscord from './references/bot-discord';
import botFeishu from './references/bot-feishu';
import botLark from './references/bot-lark';
import botQQ from './references/bot-qq';
import botSlack from './references/bot-slack';
import botTelegram from './references/bot-telegram';
import botWechat from './references/bot-wechat';
import config from './references/config';
import dashboard from './references/dashboard';
import doc from './references/doc';
import eval_ from './references/eval';
import file from './references/file';
import generate from './references/generate';
import goal from './references/goal';
import kb from './references/kb';
import memory from './references/memory';
import message from './references/message';
import model from './references/model';
import plugin from './references/plugin';
import project from './references/project';
import provider from './references/provider';
import search from './references/search';
import skill from './references/skill';
import topic from './references/topic';
import trace from './references/trace';
import workspace from './references/workspace';

export { LobeHubIdentifier };

export const LobeHubSkill: BuiltinSkill = {
  ...LobeHubManifest,
  content: systemPrompt,
  resources: toResourceMeta({
    'references/agent': agent,
    'references/agent-group': agentGroup,
    'references/artifact': artifact,
    'references/bot': bot,
    'references/bot/discord': botDiscord,
    'references/bot/feishu': botFeishu,
    'references/bot/lark': botLark,
    'references/bot/qq': botQQ,
    'references/bot/slack': botSlack,
    'references/bot/telegram': botTelegram,
    'references/bot/wechat': botWechat,
    'references/config': config,
    'references/dashboard': dashboard,
    'references/doc': doc,
    'references/eval': eval_,
    'references/file': file,
    'references/generate': generate,
    'references/goal': goal,
    'references/kb': kb,
    'references/memory': memory,
    'references/message': message,
    'references/model': model,
    'references/plugin': plugin,
    'references/project': project,
    'references/provider': provider,
    'references/search': search,
    'references/skill': skill,
    'references/topic': topic,
    'references/trace': trace,
    'references/workspace': workspace,
  }),
};
