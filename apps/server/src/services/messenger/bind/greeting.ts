import { agentDisplayName } from '@lobechat/types';
import debug from 'debug';
import { eq } from 'drizzle-orm';

import type { MessengerPlatform } from '@/config/messenger';
import { getServerDB } from '@/database/core/db-adaptor';
import { agents } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import { getBotReplyLocale, normalizeBotReplyLocale } from '@/server/services/bot/platforms/const';

import { sendMessengerPush } from '../push';

const log = debug('lobe-server:messenger:bind:greeting');

/** Inbox agents carry no name or title; this is how the product labels them. */
const INBOX_AGENT_LABEL = 'LobeAI';

export interface GreetingAgent {
  name?: string | null;
  openingMessage?: string | null;
  title?: string | null;
}

type GreetingLanguage = 'en' | 'zh';

/**
 * Brand names as people say them in each language. Kept local instead of
 * reading the platform registry: the registry pulls every binder in, and the
 * binders call back into this module.
 */
const PLATFORM_NAMES: Record<MessengerPlatform, Record<GreetingLanguage, string>> = {
  discord: { en: 'Discord', zh: 'Discord' },
  linq: { en: 'iMessage', zh: 'iMessage' },
  slack: { en: 'Slack', zh: 'Slack' },
  telegram: { en: 'Telegram', zh: 'Telegram' },
  wechat: { en: 'WeChat', zh: '微信' },
};

/**
 * Greeting language: the locale of the page that started the bind wins (the
 * person was just looking at LobeHub in it), then the platform's reply locale.
 * WeChat audiences are Chinese-speaking, matching the rest of its copy.
 */
export const resolveGreetingLanguage = (
  platform: MessengerPlatform,
  locale?: string | null,
): GreetingLanguage => {
  const normalized = normalizeBotReplyLocale(locale);
  if (normalized) return normalized.startsWith('zh') ? 'zh' : 'en';
  if (platform === 'wechat') return 'zh';
  return getBotReplyLocale(platform).startsWith('zh') ? 'zh' : 'en';
};

/**
 * What the agent says first after a bind. An agent's own opening message is
 * its voice, so it is used verbatim when set; otherwise the agent introduces
 * itself by name and tells the person this chat now reaches it.
 */
export const composeBindGreeting = (params: {
  agent: GreetingAgent | null | undefined;
  language: GreetingLanguage;
  platform: MessengerPlatform;
}): string => {
  const opening = params.agent?.openingMessage?.trim();
  if (opening) return opening;

  const name = agentDisplayName(params.agent, INBOX_AGENT_LABEL);
  const platformName = PLATFORM_NAMES[params.platform][params.language];
  if (params.language === 'zh') {
    return `嗨，我是 ${name} 👋 我们在 ${platformName} 上连上了。以后有什么事直接在这里发给我就行，我看到就回你。`;
  }
  return `Hi, I'm ${name} 👋 We're connected on ${platformName} now. Message me here anytime and I'll get back to you.`;
};

const escapeTelegramHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export type GreetingOutcome = 'sent' | 'queued' | 'skipped' | 'failed';

/**
 * Have the bound agent say hello in the IM chat that was just linked. Runs
 * after every successful bind (QR, deep link, OAuth, verify-im confirm) and
 * never throws: a failed greeting must not undo or fail the bind itself.
 *
 * Delivery goes through the platform-agnostic push path, so WeChat's send
 * window applies — a greeting sent before the person's first message there is
 * queued and replayed when they write in.
 */
export const greetAfterBind = async (params: {
  agentId: string | null | undefined;
  locale?: string | null;
  platform: MessengerPlatform;
  serverDB?: LobeChatDatabase;
  tenantId?: string;
  userId: string;
}): Promise<GreetingOutcome> => {
  try {
    const serverDB = params.serverDB ?? (await getServerDB());

    let agent: GreetingAgent | undefined;
    if (params.agentId) {
      [agent] = await serverDB
        .select({ name: agents.name, openingMessage: agents.openingMessage, title: agents.title })
        .from(agents)
        .where(eq(agents.id, params.agentId))
        .limit(1);
    }

    const content = composeBindGreeting({
      agent,
      language: resolveGreetingLanguage(params.platform, params.locale),
      platform: params.platform,
    });

    const result = await sendMessengerPush({
      // The Telegram push sends in HTML parse mode; an opening message with a
      // stray `<` or `&` would otherwise be rejected outright.
      content: params.platform === 'telegram' ? escapeTelegramHtml(content) : content,
      platform: params.platform,
      serverDB,
      tenantId: params.tenantId,
      userId: params.userId,
    });
    log('greetAfterBind: %s user=%s → %s', params.platform, params.userId, result.status);

    if (result.status === 'sent') return 'sent';
    if (result.status === 'queued') return 'queued';
    return 'skipped';
  } catch (error) {
    console.error('[messenger:greetAfterBind]', error);
    return 'failed';
  }
};
