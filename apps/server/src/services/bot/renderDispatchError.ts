import { getHeterogeneousTypeLabel } from '@lobechat/heterogeneous-agents';
import type { ChatErrorDispatchContext } from '@lobechat/types';

import type { BotReplyLocale } from './platforms/const';

interface DispatchCopy {
  credential: (name: string) => string;
  deniedCredential: (name: string) => string;
  deniedFailed: string;
  failed: string;
  title: (agent: string) => string;
}

const COPY: Partial<Record<BotReplyLocale, DispatchCopy>> = {
  'en-US': {
    credential: (name) =>
      `The cloud sandbox is missing the \`${name}\` credential. Ask the bot owner to add \`${name}\` under Settings → Credentials, then try again.`,
    deniedCredential: (name) =>
      `You don't have access to this bot's device, so the run moved to the cloud sandbox — which is missing the \`${name}\` credential. Ask the bot owner to grant you Device access in the channel settings, or to add \`${name}\` under Settings → Credentials.`,
    deniedFailed:
      "You don't have access to this bot's device, so the run moved to the cloud sandbox, which failed to start. Ask the bot owner to grant you Device access in the channel settings, or try again later.",
    failed:
      'The cloud sandbox failed to start. Try again; if it keeps happening, share the Operation ID below with the bot owner.',
    title: (agent) => `**${agent} could not start in the cloud sandbox**`,
  },
  'zh-CN': {
    credential: (name) =>
      `云端沙箱缺少 \`${name}\` 凭证。请让 Bot 所有者在「设置 → 凭证管理」中添加 \`${name}\` 后重试。`,
    deniedCredential: (name) =>
      `你没有这台设备的操作权限，已转到云端沙箱运行，但沙箱缺少 \`${name}\` 凭证。请让 Bot 所有者在频道的「设备权限」中为你授权，或在「设置 → 凭证管理」中添加 \`${name}\`。`,
    deniedFailed:
      '你没有这台设备的操作权限，已转到云端沙箱运行，但沙箱启动失败。请让 Bot 所有者在频道的「设备权限」中为你授权，或稍后重试。',
    failed: '云端沙箱启动失败。请稍后重试；如果持续出现，请把下方 Operation ID 提供给 Bot 所有者。',
    title: (agent) => `**${agent} 未能在云端沙箱启动**`,
  },
};

/**
 * Render a run that failed before its agent started as one line of cause and
 * one of next step. Built only from the allowlisted dispatch context — the raw
 * dispatch detail never reaches the channel.
 */
export const renderDispatchError = (
  context: ChatErrorDispatchContext | undefined,
  lng: BotReplyLocale = 'en-US',
): string | undefined => {
  if (context?.stage !== 'sandbox_spawn') return;
  const copy = COPY[lng] ?? COPY['en-US']!;
  const agent = getHeterogeneousTypeLabel(context.agentType) ?? 'Agent';
  const { deviceAccessDenied, missingCredential } = context;

  const cause = missingCredential
    ? deviceAccessDenied
      ? copy.deniedCredential(missingCredential)
      : copy.credential(missingCredential)
    : deviceAccessDenied
      ? copy.deniedFailed
      : copy.failed;

  return `${copy.title(agent)}\n${cause}`;
};
