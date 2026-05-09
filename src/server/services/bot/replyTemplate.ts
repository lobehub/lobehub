import type { StepPresentationData } from '../agentRuntime/types';
import { getExtremeAck } from './ackPhrases';
import { type BotReplyLocale, formatDuration } from './platforms';

// Use raw Unicode emoji instead of Chat SDK emoji placeholders,
// because bot-callback webhooks send via DiscordPlatformClient directly
// (not through the Chat SDK adapter that resolves placeholders).
const EMOJI_THINKING = '💭';

// ==================== Message Splitting ====================

const DEFAULT_CHAR_LIMIT = 1800;

export function splitMessage(text: string, limit = DEFAULT_CHAR_LIMIT): string[] {
  if (text.length <= limit) {
    // Whitespace-only input would be rejected by Telegram as "message text is empty",
    // so drop it here rather than letting downstream make a guaranteed-failing API call.
    return text.trim() ? [text] : [];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      if (remaining.trim()) chunks.push(remaining);
      break;
    }

    // Try to find a paragraph break
    let splitAt = remaining.lastIndexOf('\n\n', limit);
    // Fall back to line break
    if (splitAt <= 0) splitAt = remaining.lastIndexOf('\n', limit);
    // Hard cut
    if (splitAt <= 0) splitAt = limit;

    const chunk = remaining.slice(0, splitAt);
    // A boundary near the start (e.g. text begins with "\n\n") can produce a
    // whitespace-only chunk; emitting it would trigger Telegram's empty-text
    // 400 and silently drop the rest of the reply.
    if (chunk.trim()) chunks.push(chunk);
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  return chunks;
}

// ==================== Params ====================

type ToolCallItem = { apiName: string; arguments?: string; identifier: string };
type ToolResultItem = { apiName: string; identifier: string; isSuccess?: boolean; output?: string };

export interface RenderStepParams extends StepPresentationData {
  elapsedMs?: number;
  lastContent?: string;
  lastToolsCalling?: ToolCallItem[];
  totalToolCalls?: number;
}

// ==================== Helpers ====================

function formatToolName(tc: { apiName: string; identifier: string }): string {
  if (tc.identifier) return `**${tc.identifier}·${tc.apiName}**`;
  return `**${tc.apiName}**`;
}

function formatToolCall(tc: ToolCallItem): string {
  if (tc.arguments) {
    try {
      const args = JSON.parse(tc.arguments);
      const entries = Object.entries(args);
      if (entries.length > 0) {
        const [k, v] = entries[0];
        return `${formatToolName(tc)}(${k}: ${JSON.stringify(v)})`;
      }
    } catch {
      // invalid JSON, show name only
    }
  }
  return formatToolName(tc);
}

export function summarizeOutput(
  output: string | undefined,
  isSuccess?: boolean,
): string | undefined {
  if (!output) return undefined;
  const trimmed = output.trim();
  if (trimmed.length === 0) return undefined;

  const chars = trimmed.length;
  const status = isSuccess === false ? 'error' : 'success';
  return `${status}: ${chars.toLocaleString()} chars`;
}

function formatPendingTools(toolsCalling: ToolCallItem[]): string {
  return toolsCalling.map((tc) => `○ ${formatToolCall(tc)}`).join('\n');
}

function formatCompletedTools(
  toolsCalling: ToolCallItem[],
  toolsResult?: ToolResultItem[],
): string {
  return toolsCalling
    .map((tc, i) => {
      const callStr = `⏺ ${formatToolCall(tc)}`;
      const result = toolsResult?.[i];
      const summary = summarizeOutput(result?.output, result?.isSuccess);
      if (summary) {
        return `${callStr}\n⎿  ${summary}`;
      }
      return callStr;
    })
    .join('\n');
}

export { formatDuration, formatTokens } from './platforms';

function renderProgressHeader(
  params: { elapsedMs?: number; totalToolCalls?: number },
  lng?: BotReplyLocale,
): string {
  const { elapsedMs, totalToolCalls } = params;
  if (!totalToolCalls || totalToolCalls <= 0) return '';

  const time = elapsedMs && elapsedMs > 0 ? ` · ${formatDuration(elapsedMs)}` : '';
  return getSystemStrings(lng).toolsCallingHeader(totalToolCalls, time);
}

// ==================== 1. Start ====================

export const renderStart = getExtremeAck;

// ==================== 2. LLM Generating ====================

/**
 * LLM step just finished. Returns the message body (no usage stats).
 * Stats are handled separately via `PlatformClient.formatReply`.
 */
export function renderLLMGenerating(params: RenderStepParams, lng?: BotReplyLocale): string {
  const { content, elapsedMs, lastContent, reasoning, toolsCalling, totalToolCalls } = params;
  const displayContent = (content || lastContent)?.trim();
  const header = renderProgressHeader({ elapsedMs, totalToolCalls }, lng);

  // Sub-state: LLM decided to call tools → show content + pending tool calls (○)
  if (toolsCalling && toolsCalling.length > 0) {
    const toolsList = formatPendingTools(toolsCalling);

    if (displayContent) return `${header}${displayContent}\n\n${toolsList}`;
    return `${header}${toolsList}`;
  }

  // Sub-state: has reasoning (thinking)
  if (reasoning && !content) {
    return `${header}${EMOJI_THINKING} ${reasoning?.trim()}`;
  }

  // Sub-state: pure text content (waiting for next step)
  if (displayContent) {
    return `${header}${displayContent}`;
  }

  return `${header}${EMOJI_THINKING} ${getSystemStrings(lng).processing}`;
}

// ==================== 3. Tool Executing ====================

/**
 * Tool step just finished, LLM is next.
 * Returns the message body (no usage stats).
 */
export function renderToolExecuting(params: RenderStepParams, lng?: BotReplyLocale): string {
  const { elapsedMs, lastContent, lastToolsCalling, toolsResult, totalToolCalls } = params;
  const header = renderProgressHeader({ elapsedMs, totalToolCalls }, lng);
  const processing = `${EMOJI_THINKING} ${getSystemStrings(lng).processing}`;

  const parts: string[] = [];

  if (header) parts.push(header.trimEnd());

  if (lastContent) parts.push(lastContent.trim());

  if (lastToolsCalling && lastToolsCalling.length > 0) {
    parts.push(formatCompletedTools(lastToolsCalling, toolsResult));
    parts.push(processing);
  } else {
    parts.push(processing);
  }

  return parts.join('\n\n');
}

// ==================== 4. Final Output ====================

/**
 * Returns the final reply body (content only, no usage stats).
 * Stats are handled separately via `PlatformClient.formatReply`.
 */
export function renderFinalReply(content: string): string {
  return content.trimEnd();
}

// ==================== System message strings ====================

/**
 * Static strings emitted by the bot itself (errors, stopped notices, DM
 * rejection). Keyed by IETF locale so it lines up with the project-wide
 * `Locales` set; new platform languages can be added by dropping in another
 * entry without touching the type. A missing locale falls back to `en-US`
 * at lookup time, so we never silently render `undefined`.
 *
 * Agent conversation content is produced by the LLM and is not routed
 * through this map.
 */
type SystemStrings = {
  cmdApproveDisabled: string;
  cmdApproveFailed: string;
  cmdApproveNotOwner: string;
  cmdApproveSuccess: (label: string) => string;
  cmdApproveUnknownCode: string;
  cmdApproveUsage: string;
  cmdNewReset: string;
  cmdStopNotActive: string;
  cmdStopRequested: string;
  cmdStopUnable: string;
  dmPairingApplicantApproved: string;
  dmPairingCapacityExceeded: string;
  dmPairingCode: (code: string) => string;
  dmPairingUnavailable: string;
  dmRejectedAllowlist: string;
  dmRejectedDisabled: string;
  error: string;
  errorExceededContextWindow: string;
  errorInvalidProviderAPIKey: string;
  errorLocationNotSupported: string;
  errorModelNotFound: string;
  errorNoAvailableProvider: string;
  errorPermissionDenied: string;
  errorQuotaLimitReached: string;
  errorWithDetails: (details: string, operationId?: string) => string;
  errorWithId: (operationId: string) => string;
  groupRejectedAllowlist: string;
  groupRejectedDisabled: string;
  inlineError: (message: string) => string;
  processing: string;
  /**
   * Generic "user is not on the allowlist" copy used when the global
   * `allowFrom` gate rejects an inbound non-DM event. Delivered via
   * ephemeral (Slack) or as an out-of-band DM (Discord/Telegram fallback),
   * so the wording avoids "direct messages" — the sender did not try to DM.
   */
  senderRejected: string;
  stoppedDefault: string;
  toolsCallingHeader: (count: number, time: string) => string;
};

const SYSTEM_STRINGS: Partial<Record<BotReplyLocale, SystemStrings>> = {
  'en-US': {
    cmdApproveDisabled: 'Pairing is not enabled on this bot.',
    cmdApproveFailed:
      "Couldn't save the approval — the bot's settings may be unavailable. The pairing code is still valid; please try `/approve` again in a moment.",
    cmdApproveNotOwner: 'Only the bot owner can approve pairing requests.',
    cmdApproveSuccess: (label) => `Approved ${label}.`,
    cmdApproveUnknownCode: 'That pairing code is unknown or has expired.',
    cmdApproveUsage: 'Usage: `/approve <code>`',
    cmdNewReset: 'Conversation reset. Your next message will start a new topic.',
    cmdStopNotActive: 'No active execution to stop.',
    cmdStopRequested: 'Stop requested.',
    cmdStopUnable: 'Unable to stop the current execution.',
    dmPairingApplicantApproved: "You've been approved. Send your message again.",
    dmPairingCapacityExceeded:
      'This bot is handling too many pairing requests right now. Please try again in a few minutes.',
    dmPairingCode: (code) =>
      `To DM this bot, send this pairing code to the bot's owner: \`${code}\`. They run \`/approve ${code}\` to grant you access. The code expires in 1 hour.`,
    dmPairingUnavailable: 'Pairing is temporarily unavailable on this bot. Please try again later.',
    dmRejectedAllowlist:
      "Sorry, you aren't authorized to send direct messages to this bot. Please contact the bot's owner if you need access.",
    dmRejectedDisabled:
      "This bot isn't accepting direct messages. Please reach out by mentioning it in a shared channel or group instead.",
    error: '**Agent Execution Failed**',
    errorExceededContextWindow:
      "**Context window exceeded.**\nThe conversation is too long for this model. Send `/new` to start a fresh topic, or switch to a model with a larger context window in the agent's settings.",
    errorInvalidProviderAPIKey:
      "**Invalid or missing API key.**\nThe configured model provider rejected its API key. Please verify the key in the agent's provider settings (it may be expired, revoked, or mistyped) and try again.",
    errorLocationNotSupported:
      "**Region not supported.**\nThe configured model provider isn't available from this server's region. Please switch to a different provider or model in the agent's settings.",
    errorModelNotFound:
      "**Model not found.**\nThe configured model isn't available — it may have been removed or renamed. Please pick a different model in the agent's settings.",
    errorNoAvailableProvider:
      "**No model provider configured.**\nThis bot's agent has no available model provider — please add an API key and enable a provider in the agent's settings, then try again.",
    errorPermissionDenied:
      "**Permission denied by the model provider.**\nThe API key doesn't have access to the requested model or operation. Please check the key's permissions, or switch to a model your account is authorized to use.",
    errorQuotaLimitReached:
      "**Provider quota exhausted.**\nThe configured model provider is out of quota or rate-limited. Please wait a moment and try again, top up the account, or switch to a different provider in the agent's settings.",
    errorWithDetails: (details, operationId) =>
      operationId
        ? `**Agent Execution Failed**\nOperation ID: \`${operationId}\`\nDetails:\n\`\`\`\n${details}\n\`\`\``
        : `**Agent Execution Failed**. Details:\n\`\`\`\n${details}\n\`\`\``,
    errorWithId: (operationId) => `**Agent Execution Failed**\nOperation ID: \`${operationId}\``,
    groupRejectedAllowlist:
      "This bot isn't enabled in this channel. Please contact the bot's owner if you need access.",
    groupRejectedDisabled:
      "This bot doesn't respond in groups or channels. Please reach out via direct message instead.",
    inlineError: (message) => `**Error**: ${message}`,
    processing: 'Processing...',
    senderRejected:
      "Sorry, you aren't authorized to interact with this bot. Please contact the bot's owner if you need access.",
    stoppedDefault: 'Execution stopped.',
    toolsCallingHeader: (count, time) => `> total **${count}** tools calling ${time}\n\n`,
  },
  'zh-CN': {
    cmdApproveDisabled: '该机器人未启用配对审批模式。',
    cmdApproveFailed: '保存审批失败，机器人设置暂不可用。配对码仍然有效，请稍后重试 `/approve`。',
    cmdApproveNotOwner: '只有机器人管理员可以审批配对请求。',
    cmdApproveSuccess: (label) => `已审批 ${label}。`,
    cmdApproveUnknownCode: '该配对码不存在或已过期。',
    cmdApproveUsage: '用法：`/approve <配对码>`',
    cmdNewReset: '对话已重置，下一条消息会开启新话题。',
    cmdStopNotActive: '当前没有正在执行的任务可以停止。',
    cmdStopRequested: '已发出停止请求。',
    cmdStopUnable: '无法停止当前执行。',
    dmPairingApplicantApproved: '已通过审批，请重新发送你的消息。',
    dmPairingCapacityExceeded: '该机器人当前待审批请求过多，请稍后再试。',
    dmPairingCode: (code) =>
      `若要私信该机器人，请把以下配对码发给机器人管理员：\`${code}\`，他们将通过 \`/approve ${code}\` 命令为你授权。配对码 1 小时后失效。`,
    dmPairingUnavailable: '配对功能暂时不可用，请稍后再试。',
    dmRejectedAllowlist: '抱歉，您没有私信该机器人的权限。如需访问请联系机器人管理员。',
    dmRejectedDisabled: '该机器人不接受私信。请在共享频道或群组里 @它来联系。',
    error: '**Agent 执行失败**',
    errorExceededContextWindow:
      '**上下文已超出模型上限**\n当前对话长度超过了该模型的上下文窗口。可以发送 `/new` 开启新话题，或在 Agent 设置中切换到上下文更大的模型后重试。',
    errorInvalidProviderAPIKey:
      '**API Key 无效或缺失**\n所配置的模型 Provider 拒绝了 API Key，可能已过期、被吊销或填写错误。请到 Agent 的 Provider 设置中检查并更新 API Key 后重试。',
    errorLocationNotSupported:
      '**当前区域不被支持**\n所配置的模型 Provider 不允许从该服务器所在区域访问。请在 Agent 设置中切换到其他 Provider 或模型。',
    errorModelNotFound:
      '**未找到对应模型**\n所配置的模型不可用，可能已下线或更名。请在 Agent 设置中选择其他模型后重试。',
    errorNoAvailableProvider:
      '**未配置可用的模型 Provider**\n该机器人的 Agent 当前没有可用的模型 Provider，请在 Agent 设置中添加 API Key 并启用一个 Provider 后重试。',
    errorPermissionDenied:
      '**模型 Provider 拒绝访问**\nAPI Key 没有访问该模型或操作的权限。请检查 Key 的权限范围，或在 Agent 设置中切换到当前账户已授权的模型。',
    errorQuotaLimitReached:
      '**Provider 配额已用尽**\n所配置的模型 Provider 已达到配额上限或被限流。请稍后重试、为账户充值，或在 Agent 设置中切换到其他 Provider。',
    errorWithDetails: (details, operationId) =>
      operationId
        ? `**Agent 执行失败**\nOperation ID: \`${operationId}\`\n详细信息：\n\`\`\`\n${details}\n\`\`\``
        : `**Agent 执行失败**，详细信息：\n\`\`\`\n${details}\n\`\`\``,
    errorWithId: (operationId) => `**Agent 执行失败**\nOperation ID: \`${operationId}\``,
    groupRejectedAllowlist: '该机器人未在此频道启用。如需访问请联系机器人管理员。',
    groupRejectedDisabled: '该机器人不在群组或频道中响应。请通过私信联系。',
    inlineError: (message) => `**错误**：${message}`,
    processing: '处理中…',
    senderRejected: '抱歉，您没有与该机器人交互的权限。如需访问请联系机器人管理员。',
    stoppedDefault: '执行已停止。',
    toolsCallingHeader: (count, time) => `> 共 **${count}** 次工具调用 ${time}\n\n`,
  },
};

const DEFAULT_REPLY_LOCALE: BotReplyLocale = 'en-US';

const getSystemStrings = (lng: BotReplyLocale = DEFAULT_REPLY_LOCALE): SystemStrings =>
  SYSTEM_STRINGS[lng] ?? SYSTEM_STRINGS[DEFAULT_REPLY_LOCALE]!;

export function renderError(operationId?: string, lng?: BotReplyLocale): string {
  const strings = getSystemStrings(lng);
  return operationId ? strings.errorWithId(operationId) : strings.error;
}

/**
 * Map known `AgentRuntimeError` codes to the `SystemStrings` field that
 * carries the friendly, actionable copy for that failure mode. Codes not in
 * this map fall back to the generic `Operation ID` template — opaque enough
 * not to leak internal error strings, but still traceable in logs.
 *
 * When adding a new code: extend `SystemStrings`, drop the copy into both the
 * `en-US` and `zh-CN` dictionaries, then add the mapping here.
 */
const FRIENDLY_ERROR_BY_TYPE: Record<string, keyof SystemStrings> = {
  ExceededContextWindow: 'errorExceededContextWindow',
  InsufficientQuota: 'errorQuotaLimitReached',
  InvalidProviderAPIKey: 'errorInvalidProviderAPIKey',
  LocationNotSupportError: 'errorLocationNotSupported',
  ModelNotFound: 'errorModelNotFound',
  NoAvailableProvider: 'errorNoAvailableProvider',
  PermissionDenied: 'errorPermissionDenied',
  QuotaLimitReached: 'errorQuotaLimitReached',
};

/**
 * Render an agent-execution failure for the user. Switches on the stable
 * `errorType` code (from `AgentRuntimeError.chat`) to surface a friendly,
 * actionable message for known failure modes.
 *
 * For unknown error codes — or when `errorType` is missing — falls back to
 * the legacy `Operation ID` template.
 */
export function renderAgentError(
  errorType: string | undefined,
  operationId: string | undefined,
  lng?: BotReplyLocale,
): string {
  const strings = getSystemStrings(lng);

  const stringKey = errorType ? FRIENDLY_ERROR_BY_TYPE[errorType] : undefined;
  if (stringKey) {
    const value = strings[stringKey];
    if (typeof value === 'string') {
      // Append the operationId as a traceable footer so operators can still
      // grep logs for the failure even when the user-facing copy is a
      // friendly, actionable message rather than the raw "Operation ID" line.
      return operationId ? `${value}\nOperation ID: \`${operationId}\`` : value;
    }
  }

  return operationId ? strings.errorWithId(operationId) : strings.error;
}

export function renderStopped(message?: string, lng?: BotReplyLocale): string {
  return message ?? getSystemStrings(lng).stoppedDefault;
}

/**
 * Verbose error template used when we want to surface the underlying error
 * message verbatim (typically for stale-topic or FK violations where the raw
 * detail helps the operator diagnose the failure).
 */
export function renderErrorWithDetails(
  details: string,
  lng?: BotReplyLocale,
  operationId?: string,
): string {
  return getSystemStrings(lng).errorWithDetails(details, operationId);
}

/**
 * Compact `**Error**: …` line used as a last-resort handler-level fallback
 * when an unexpected exception escapes the bridge / catch-all path.
 */
export function renderInlineError(message: string, lng?: BotReplyLocale): string {
  return getSystemStrings(lng).inlineError(message);
}

export type CommandReplyKey =
  | 'cmdApproveDisabled'
  | 'cmdApproveFailed'
  | 'cmdApproveNotOwner'
  | 'cmdApproveUnknownCode'
  | 'cmdApproveUsage'
  | 'cmdNewReset'
  | 'cmdStopNotActive'
  | 'cmdStopRequested'
  | 'cmdStopUnable'
  | 'dmPairingApplicantApproved';

/**
 * Render a slash-command response (e.g. `/new`, `/stop`). Centralized so the
 * command handlers don't each carry their own English literal.
 */
export function renderCommandReply(key: CommandReplyKey, lng?: BotReplyLocale): string {
  return getSystemStrings(lng)[key];
}

/**
 * Render the owner-facing confirmation when `/approve` succeeds. The label
 * is the applicant's display name when known, otherwise their platform
 * user ID — owners shouldn't have to do the lookup themselves to know what
 * they just approved.
 */
export function renderApproveSuccess(label: string, lng?: BotReplyLocale): string {
  return getSystemStrings(lng).cmdApproveSuccess(label);
}

/**
 * Render the system message a stranger sees after their first DM when the
 * bot is in pairing mode. Variants:
 *
 * - `code`: a fresh pairing code was issued. Bake the code into the body
 *   so it's copy-pastable from the chat client without follow-up.
 * - `capacity-exceeded`: per-bot pending cap hit; no code created. Tell
 *   the applicant to retry rather than silently dropping them.
 * - `unavailable`: Redis isn't wired (pairing requires it for cross-process
 *   pending state). Surface the temporary state so the operator can fix
 *   the deployment instead of debugging mysterious silence.
 */
export function renderDmPairing(
  variant: 'capacity-exceeded' | 'code' | 'unavailable',
  lng?: BotReplyLocale,
  params?: { code?: string },
): string {
  const strings = getSystemStrings(lng);
  if (variant === 'code' && params?.code) return strings.dmPairingCode(params.code);
  if (variant === 'capacity-exceeded') return strings.dmPairingCapacityExceeded;
  return strings.dmPairingUnavailable;
}

/**
 * Render the system message shown to a sender whose DM was blocked by the
 * channel's DM Policy. We split disabled vs allowlist so the user can act on
 * the answer (e.g. ping in a channel instead, or ask the owner for access).
 */
export function renderDmRejected(reason: 'disabled' | 'allowlist', lng?: BotReplyLocale): string {
  const strings = getSystemStrings(lng);
  return reason === 'disabled' ? strings.dmRejectedDisabled : strings.dmRejectedAllowlist;
}

/**
 * Render the system message shown when an inbound non-DM event was blocked
 * by Group Policy. Same disabled-vs-allowlist split as
 * {@link renderDmRejected} so the sender can pivot (try DM, ask the owner).
 */
export function renderGroupRejected(
  reason: 'disabled' | 'allowlist',
  lng?: BotReplyLocale,
): string {
  const strings = getSystemStrings(lng);
  return reason === 'disabled' ? strings.groupRejectedDisabled : strings.groupRejectedAllowlist;
}

/**
 * Render the system message shown when the **global `allowFrom`** gate
 * rejected the sender of a non-DM event (group / channel / thread). The
 * notice is delivered out-of-band — ephemerally on Slack, via DM fallback
 * on Discord/Telegram — so the copy intentionally avoids "direct messages"
 * (the sender did not try to DM, they @-mentioned in a group).
 */
export function renderSenderRejected(lng?: BotReplyLocale): string {
  return getSystemStrings(lng).senderRejected;
}

// ==================== Dispatcher ====================

/**
 * Dispatch to the correct template based on step state.
 * Returns message body only — caller handles stats via platform.
 */
export function renderStepProgress(params: RenderStepParams, lng?: BotReplyLocale): string {
  if (params.stepType === 'call_llm') {
    return renderLLMGenerating(params, lng);
  }
  return renderToolExecuting(params, lng);
}
