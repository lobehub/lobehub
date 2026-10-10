import {
  getHeterogeneousTypeLabel,
  isLocalHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { formatHeteroErrorId, HETERO_ERROR_SPECS } from '@lobechat/heterogeneous-agents/errors';
import type { ChatErrorHeterogeneousContext } from '@lobechat/types';

import { getServerTranslations } from '@/libs/i18n/serverTranslation';

import type { BotReplyLocale } from './platforms/const';

/** Render only allowlisted context. Raw CLI stderr and paths stay in diagnostics. */
export const renderHeterogeneousError = (
  context: ChatErrorHeterogeneousContext | undefined,
  lng?: BotReplyLocale,
): string | undefined => {
  if (
    !context ||
    !isLocalHeterogeneousType(context.agentType) ||
    !Object.hasOwn(HETERO_ERROR_SPECS, context.kind)
  )
    return;
  const spec = HETERO_ERROR_SPECS[context.kind as keyof typeof HETERO_ERROR_SPECS];
  const { t } = getServerTranslations('heterogeneousError', lng);
  const prefix = `heterogeneous.${spec.kind}` as const;
  const agent = getHeterogeneousTypeLabel(context.agentType) ?? 'Agent';
  const lines = [`**${agent}: ${t(`${prefix}.title`)}**`, t(`${prefix}.description`, { agent })];
  if (spec.kind === 'usage_limit') {
    if (context.rateLimitType === 'seven_day' || context.rateLimitType === 'five_hour') {
      lines.push(t(`heterogeneous.window.${context.rateLimitType}`));
    }
    if (
      typeof context.resetsAt === 'number' &&
      Number.isFinite(context.resetsAt) &&
      context.resetsAt > 0 &&
      context.resetsAt < 8640000000000
    ) {
      const time = new Date(context.resetsAt * 1000).toISOString().replace('T', ' ').slice(0, 16);
      lines.push(t('heterogeneous.reset', { time }));
    }
  }
  lines.push(`${lng === 'zh-CN' ? '错误码' : 'Error code'}: \`${formatHeteroErrorId(spec.kind)}\``);
  return lines.join('\n');
};
