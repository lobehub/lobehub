/**
 * Qoder CLI adapter.
 *
 * Qoder's stream-json protocol is intentionally compatible with the
 * assistant/user/result framing used by Claude Code. Reuse that mature state
 * machine, but keep Qoder as a first-class provider: every normalized event,
 * tool payload, error, and usage record is stamped with Qoder's identity while
 * shared derived state such as Task tool todos remains intact for the UI.
 */

import { getHeterogeneousAgentConfigOrThrow } from '../config';
import type { HeterogeneousAgentEvent } from '../types';
import { ClaudeCodeAdapter } from './claudeCode';

export const QODER_IDENTIFIER = 'qoder';

const CLAUDE_CODE_AUTH_DOCS_URL = getHeterogeneousAgentConfigOrThrow('claude-code').auth.docsUrl;
const QODER_AUTH_DOCS_URL = getHeterogeneousAgentConfigOrThrow(QODER_IDENTIFIER).auth.docsUrl;
const QODER_AUTH_REQUIRED_PATTERNS = [/not logged in/i, /please run \/login/i] as const;

const isQoderAuthAssistant = (raw: unknown): boolean => {
  if (!raw || typeof raw !== 'object') return false;
  const event = raw as { message?: { content?: unknown }; type?: string };
  if (event.type !== 'assistant' || !Array.isArray(event.message?.content)) return false;

  const text = event.message.content
    .map((block) =>
      block && typeof block === 'object' && 'text' in block && typeof block.text === 'string'
        ? block.text
        : '',
    )
    .join(' ');

  return QODER_AUTH_REQUIRED_PATTERNS.every((pattern) => pattern.test(text));
};

const normalizeQoderValue = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const entry of value) normalizeQoderValue(entry);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [childKey, childValue] of Object.entries(record)) {
    if (
      (childKey === 'agentType' || childKey === 'identifier' || childKey === 'provider') &&
      childValue === 'claude-code'
    ) {
      record[childKey] = QODER_IDENTIFIER;
      continue;
    }
    if (childKey === 'docsUrl' && childValue === CLAUDE_CODE_AUTH_DOCS_URL) {
      record[childKey] = QODER_AUTH_DOCS_URL;
      continue;
    }
    if (
      (childKey === 'error' || childKey === 'message') &&
      typeof childValue === 'string' &&
      childValue.includes('Claude Code')
    ) {
      record[childKey] = childValue.replaceAll('Claude Code', 'Qoder');
      continue;
    }
    normalizeQoderValue(childValue);
  }
};

const normalizeQoderEvents = (events: HeterogeneousAgentEvent[]): HeterogeneousAgentEvent[] => {
  for (const event of events) normalizeQoderValue(event);
  return events;
};

export class QoderAdapter extends ClaudeCodeAdapter {
  adapt(raw: unknown): HeterogeneousAgentEvent[] {
    // Qoder reports a missing login as both an assistant text block and a
    // terminal `result { subtype: "success", is_error: true }`. Suppress the
    // transient text echo; the result becomes one structured auth guide error.
    if (isQoderAuthAssistant(raw)) return [];
    return normalizeQoderEvents(super.adapt(raw));
  }

  flush(): HeterogeneousAgentEvent[] {
    return normalizeQoderEvents(super.flush());
  }
}
