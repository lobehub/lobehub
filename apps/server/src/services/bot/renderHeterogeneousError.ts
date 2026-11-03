import {
  getHeterogeneousTypeLabel,
  isLocalHeterogeneousType,
} from '@lobechat/heterogeneous-agents';
import {
  formatHeteroErrorId,
  HETERO_ERROR_SPECS,
  type HeteroErrorKind,
} from '@lobechat/heterogeneous-agents/errors';
import type { ChatErrorHeterogeneousContext } from '@lobechat/types';

const COPY: Record<HeteroErrorKind, { description: string; title: string }> = {
  aborted: {
    description: 'This {{agent}} task was stopped. Send a new request when you want to continue.',
    title: 'Task stopped',
  },
  agent_failed: {
    description:
      '{{agent}} stopped without a recognized cause. Share the Operation ID with the bot owner or support to investigate.',
    title: 'Agent task failed',
  },
  auth_required: {
    description: 'Ask the bot owner to sign in again on the device running {{agent}}.',
    title: 'Sign-in required',
  },
  cli_not_found: {
    description:
      'Ask the bot owner to install or repair {{agent}} on the device running this task.',
    title: 'Agent CLI unavailable',
  },
  credit_limit: {
    description:
      'Ask the bot owner to add credits to the account used by {{agent}}, or switch models. Waiting for a quota reset will not restore these credits.',
    title: 'Credits exhausted',
  },
  invalid_request: {
    description:
      'The provider rejected the request sent by {{agent}}. Try a new topic; if it persists, share the Operation ID with support.',
    title: 'Request rejected',
  },
  max_turns: {
    description:
      '{{agent}} reached its step limit before finishing. Split the task into smaller steps, or ask the bot owner to adjust the limit.',
    title: 'Step limit reached',
  },
  model_unavailable: {
    description:
      'The model selected for {{agent}} is unavailable. Ask the bot owner to choose another model.',
    title: 'Model unavailable',
  },
  network_drop: {
    description:
      '{{agent}} lost its connection before finishing. Retry; if it happens again, ask the bot owner to check the running device’s network and proxy settings.',
    title: 'Connection interrupted',
  },
  resume_cwd_mismatch: {
    description:
      'Ask the bot owner to restore the working directory used by this {{agent}} session, or start a new topic.',
    title: 'Session directory changed',
  },
  resume_thread_not_found: {
    description:
      '{{agent}} could not find the previous session. Start a new topic and resend the request.',
    title: 'Previous session unavailable',
  },
  server_overloaded: {
    description: 'The provider behind {{agent}} is busy or unavailable. Please try again shortly.',
    title: 'Provider temporarily unavailable',
  },
  server_throttle: {
    description:
      'The provider is temporarily limiting requests from {{agent}}. Please wait a moment and try again.',
    title: 'Requests temporarily limited',
  },
  unsupported_attachment: {
    description:
      '{{agent}} could not read an attachment. Remove it or convert it to a supported format, then resend the request.',
    title: 'Attachment unsupported',
  },
  usage_limit: {
    description:
      'The account used by {{agent}} has exhausted its allowance. Wait for the quota to reset, or ask the bot owner to switch to an account or model with available quota.',
    title: 'Usage limit reached',
  },
  working_directory_not_found: {
    description:
      'The working directory for {{agent}} is missing. Ask the bot owner to restore it or choose an existing directory.',
    title: 'Working directory unavailable',
  },
};

const RATE_LIMIT_WINDOW_COPY = {
  five_hour: 'Session allowance exhausted.',
  seven_day: 'Weekly allowance exhausted.',
};

/** Render only allowlisted context. Raw CLI stderr and paths stay in diagnostics. */
export const renderHeterogeneousError = (
  context: ChatErrorHeterogeneousContext | undefined,
): string | undefined => {
  if (
    !context ||
    !isLocalHeterogeneousType(context.agentType) ||
    !Object.hasOwn(HETERO_ERROR_SPECS, context.kind)
  )
    return;
  const spec = HETERO_ERROR_SPECS[context.kind as keyof typeof HETERO_ERROR_SPECS];
  const copy = COPY[spec.kind];
  const agent = getHeterogeneousTypeLabel(context.agentType) ?? 'Agent';
  const lines = [`**${agent}: ${copy.title}**`, copy.description.replaceAll('{{agent}}', agent)];
  if (spec.kind === 'usage_limit') {
    if (context.rateLimitType === 'seven_day' || context.rateLimitType === 'five_hour') {
      lines.push(RATE_LIMIT_WINDOW_COPY[context.rateLimitType]);
    }
    if (
      typeof context.resetsAt === 'number' &&
      Number.isFinite(context.resetsAt) &&
      context.resetsAt > 0 &&
      context.resetsAt < 8640000000000
    ) {
      const time = new Date(context.resetsAt * 1000).toISOString().replace('T', ' ').slice(0, 16);
      lines.push(`Quota resets at ${time} (UTC).`);
    }
  }
  lines.push(`Error code: \`${formatHeteroErrorId(spec.kind)}\``);
  return lines.join('\n');
};
