import {
  getHeterogeneousTypeLabel,
  isLocalHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import { formatHeteroErrorId, HETERO_ERROR_SPECS } from '@lobechat/heterogeneous-agents/errors';
import type { ChatErrorHeterogeneousContext } from '@lobechat/types';

import english from '@/locales/default/modelRuntime';

import chinese from '../../../../../locales/zh-CN/modelRuntime.json';
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
  const catalog: Record<string, string> = lng === 'zh-CN' ? chinese : english;
  const prefix = `heterogeneous.${spec.kind}`;
  const agent = getHeterogeneousTypeLabel(context.agentType) ?? 'Agent';
  const lines = [
    `**${agent}: ${catalog[`${prefix}.title`]}**`,
    catalog[`${prefix}.description`].replaceAll('{{agent}}', agent),
  ];
  if (spec.kind === 'usage_limit') {
    if (context.rateLimitType === 'seven_day' || context.rateLimitType === 'five_hour') {
      lines.push(catalog[`heterogeneous.window.${context.rateLimitType}`]);
    }
    if (
      typeof context.resetsAt === 'number' &&
      Number.isFinite(context.resetsAt) &&
      context.resetsAt > 0 &&
      context.resetsAt < 8640000000000
    ) {
      const time = new Date(context.resetsAt * 1000).toISOString().replace('T', ' ').slice(0, 16);
      lines.push(catalog['heterogeneous.reset'].replace('{{time}}', time));
    }
  }
  lines.push(`${lng === 'zh-CN' ? '错误码' : 'Error code'}: \`${formatHeteroErrorId(spec.kind)}\``);
  return lines.join('\n');
};
