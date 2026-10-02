import type { AgentAccountContext, AgentInboxMessage } from '@lobechat/types';
import debug from 'debug';

import { BaseSystemRoleProvider } from '../base/BaseSystemRoleProvider';
import type { PipelineContext, ProcessorOptions } from '../types';

declare module '../types' {
  interface PipelineContextMetadataOverrides {
    agentAccountContextInjected?: boolean;
  }
}

const log = debug('context-engine:provider:AgentAccountContextInjector');

/** How much of an inbound body to show. The full text stays in the inbox. */
const BODY_PREVIEW_CHARS = 600;

const capabilityWords = (capabilities: {
  login?: boolean;
  receive: boolean;
  send: boolean;
  sign?: boolean;
}) => {
  const words: string[] = [];
  if (capabilities.receive) words.push('receive');
  if (capabilities.send) words.push('send');
  if (capabilities.sign) words.push('sign');
  if (capabilities.login) words.push('log in');
  return words.length > 0 ? words.join('/') : 'none';
};

const truncate = (text: string) => {
  const collapsed = text.replaceAll(/\s+/g, ' ').trim();
  return collapsed.length > BODY_PREVIEW_CHARS
    ? `${collapsed.slice(0, BODY_PREVIEW_CHARS)}…`
    : collapsed;
};

const renderInboxMessage = (message: AgentInboxMessage) => {
  const parts = [`from ${message.from}`];
  if (message.subject) parts.push(`subject ${JSON.stringify(message.subject)}`);
  parts.push(`received ${message.receivedAt.toISOString()}`);
  if (message.codes.length > 0) parts.push(`codes ${message.codes.join(', ')}`);
  if (message.readAt === null) parts.push('unread');

  return `- ${parts.join(' · ')}\n  ${truncate(message.text)}`;
};

export interface AgentAccountContextInjectorConfig {
  context?: AgentAccountContext;
  enabled?: boolean;
}

/**
 * Agent account / inbox injector.
 *
 * Appends the agent's own identity — the addresses it owns and the newest
 * messages waiting in its inbox — to the system message, so "I have mail" is
 * state the model starts every turn with instead of a capability it has to
 * discover and pay a tool schema for.
 *
 * Injection is opt-in on the data: no accounts and no inbox means no block, so
 * an agent without identity pays nothing.
 */
export class AgentAccountContextInjector extends BaseSystemRoleProvider {
  readonly name = 'AgentAccountContextInjector';

  constructor(
    private config: AgentAccountContextInjectorConfig,
    options: ProcessorOptions = {},
  ) {
    super(options);
  }

  protected buildSystemRoleContent(_context: PipelineContext): string | null {
    if (this.config.enabled === false) {
      log('Disabled, skipping identity/account injection');
      return null;
    }

    const context = this.config.context;
    if (!context || (context.accounts.length === 0 && context.inbox.unreadCount === 0)) {
      log('No accounts or unread mail, skipping identity/account injection');
      return null;
    }

    const parts: string[] = ['<agent_identity>'];

    if (context.accounts.length === 0) {
      parts.push('You do not own any addresses yet.');
    } else {
      parts.push('You own the following addresses. Anything sent to them lands in your inbox:');
      for (const account of context.accounts) {
        const label = account.displayName ? ` (${account.displayName})` : '';
        parts.push(
          `- ${account.kind} ${account.identifier}${label} — ${account.provider}, can ${capabilityWords(account.capabilities)}`,
        );
      }
    }

    parts.push('');
    parts.push(`<inbox unread="${context.inbox.unreadCount}">`);
    if (context.inbox.latest.length === 0) {
      parts.push('No messages yet.');
    } else {
      for (const message of context.inbox.latest) parts.push(renderInboxMessage(message));
    }
    parts.push('</inbox>');
    parts.push('</agent_identity>');

    return parts.join('\n');
  }

  protected onInjected(context: PipelineContext): void {
    context.metadata.agentAccountContextInjected = true;
  }
}
