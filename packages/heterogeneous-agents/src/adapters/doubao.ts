/**
 * Doubao CLI adapter.
 *
 * Doubao CLI (@bytedance/doubao-cli) emits a stream-json protocol that is
 * intentionally shaped like Claude Code's assistant/user/result framing.
 * Verified against doubao-cli 2.37.2 (linux-x64 native build): the CLI's
 * `entry-cli-chat` bundle carries the same event vocabulary —
 * `system` / `assistant` / `user` / `result` / `stream_event`, plus
 * `content_block_delta`, `text_delta`, `tool_use`, `tool_result`,
 * `session_id` and `is_error`, and `system` events carry `subtype: "init"`.
 *
 * Reuse the mature Claude Code state machine, but keep Doubao as a
 * first-class provider: every normalized event, tool payload, error and
 * usage record is stamped with Doubao's identity.
 *
 * Key differences from Claude Code, handled below:
 *   - Auth: QR-code login (`doubao login`), not an API key. Auth failures
 *     surface as `login_required: 当前未登录，请运行 doubao login 登录`.
 *   - No `thinking_delta` in the bundle; reasoning chunks may simply be
 *     absent. Base class already tolerates missing reasoning.
 *   - `--effort` accepts none|minimal|low|medium|high|xhigh|max.
 */

import { getHeterogeneousAgentConfigOrThrow } from '../config';
import type { HeterogeneousAgentEvent } from '../types';
import { ClaudeCodeAdapter } from './claudeCode';

export const DOUBAO_IDENTIFIER = 'doubao';

const CLAUDE_CODE_AUTH_DOCS_URL = getHeterogeneousAgentConfigOrThrow('claude-code').auth.docsUrl;
const DOUBAO_AUTH_DOCS_URL = getHeterogeneousAgentConfigOrThrow(DOUBAO_IDENTIFIER).auth.docsUrl;

/**
 * Doubao reports a missing login on stderr / plain output as
 * `login_required: 当前未登录，请运行 \`doubao login\` 登录`.
 * Match both the machine token and the Chinese hint.
 */
const DOUBAO_AUTH_REQUIRED_PATTERNS = [
  /login_required/i,
  /当前未登录/,
  /请运行\s*`?doubao\s+login`?/i,
] as const;

const isDoubaoAuthFailure = (raw: unknown): boolean => {
  // Plain-string payload (stderr line) — check directly.
  if (typeof raw === 'string') {
    return DOUBAO_AUTH_REQUIRED_PATTERNS.some((p) => p.test(raw));
  }
  if (!raw || typeof raw !== 'object') return false;

  const event = raw as {
    error?: unknown;
    is_error?: unknown;
    message?: { content?: unknown };
    result?: unknown;
    subtype?: unknown;
    type?: unknown;
  };

  // Terminal `result` frame carrying an auth error string.
  if (event.type === 'result') {
    const text = [event.result, event.error]
      .filter((v): v is string => typeof v === 'string')
      .join(' ');
    if (text && DOUBAO_AUTH_REQUIRED_PATTERNS.some((p) => p.test(text))) return true;
  }

  // Plain `{ error: "login_required: ..." }` frame.
  if (typeof event.error === 'string') {
    const errorText: string = event.error;
    return DOUBAO_AUTH_REQUIRED_PATTERNS.some((p) => p.test(errorText));
  }

  // Assistant text echo.
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    const text = event.message.content
      .map((block) =>
        block && typeof block === 'object' && 'text' in block && typeof block.text === 'string'
          ? block.text
          : '',
      )
      .join(' ');
    return text.length > 0 && DOUBAO_AUTH_REQUIRED_PATTERNS.some((p) => p.test(text));
  }

  return false;
};

const normalizeDoubaoValue = (value: unknown): void => {
  if (!value || typeof value !== 'object') return;

  if (Array.isArray(value)) {
    for (const entry of value) normalizeDoubaoValue(entry);
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [childKey, childValue] of Object.entries(record)) {
    if (
      (childKey === 'agentType' || childKey === 'identifier' || childKey === 'provider') &&
      childValue === 'claude-code'
    ) {
      record[childKey] = DOUBAO_IDENTIFIER;
      continue;
    }
    if (childKey === 'docsUrl' && childValue === CLAUDE_CODE_AUTH_DOCS_URL) {
      record[childKey] = DOUBAO_AUTH_DOCS_URL;
      continue;
    }
    if (
      (childKey === 'error' || childKey === 'message') &&
      typeof childValue === 'string' &&
      childValue.includes('Claude Code')
    ) {
      record[childKey] = childValue.replaceAll('Claude Code', 'Doubao');
      continue;
    }
    normalizeDoubaoValue(childValue);
  }
};

const normalizeDoubaoEvents = (events: HeterogeneousAgentEvent[]): HeterogeneousAgentEvent[] => {
  for (const event of events) normalizeDoubaoValue(event);
  return events;
};

export class DoubaoAdapter extends ClaudeCodeAdapter {
  /** Everything this adapter has already surfaced as text, for echo de-dup. */
  private visibleText = '';
  /**
   * Doubao emits `message_id` on every `stream_event` but never a
   * `message_start`. Teach the inherited state machine the id before delegating,
   * so its streamed-text ledger is populated and the closing `assistant` echo
   * is de-duped instead of printed a second time.
   */
  private adoptDoubaoMessageId(raw: unknown): void {
    const frame = raw as { message_id?: unknown; type?: unknown } | null;
    if (!frame || frame.type !== 'stream_event') return;
    const messageId = frame.message_id;
    if (typeof messageId !== 'string' || !messageId) return;

    // Base class fields are private; a narrow structural cast keeps this
    // adapter self-contained without touching claudeCode.ts.
    const self = this as unknown as {
      currentStreamEventMessageId?: string;
      sawStreamEvent?: boolean;
      streamedTextByMessageId?: Map<string, string>;
    };
    self.currentStreamEventMessageId = messageId;
    // Seeing a stream_event is exactly how the base class detects
    // `--include-partial-messages`; Doubao is always in that mode.
    self.sawStreamEvent = true;
    self.streamedTextByMessageId ??= new Map<string, string>();
  }

  adapt(raw: unknown): HeterogeneousAgentEvent[] {
    // Doubao reports a missing login as a `login_required:` line and/or a
    // terminal result frame with `is_error`. Emit nothing for the raw text
    // echo; let the runtime surface one structured auth-guide error.
    if (isDoubaoAuthFailure(raw)) return [];
    this.adoptDoubaoMessageId(raw);

    const flattened = this.normalizeResultPayload(raw);
    const events = super.adapt(flattened);

    // Last-resort text recovery: Doubao can deliver the answer ONLY in the
    // terminal `result` frame (non-streaming runs, or a stream cut short). The
    // base class emits no text in that case, which would silently drop the
    // answer. Verified gap — see probe_nostream.ts in the adapter test dir.
    const recovered = this.recoverResultText(flattened, events);
    for (const event of recovered) {
      if (event.type === 'stream_chunk' && typeof event.data?.content === 'string') {
        this.visibleText += event.data.content;
      }
    }
    return normalizeDoubaoEvents(recovered);
  }

  /**
   * Emit the terminal `result` text as a chunk when nothing else carried it.
   * Only fires for a non-empty text result on a successful frame, so normal
   * streaming runs (deltas already emitted) are untouched.
   */
  private recoverResultText(
    raw: unknown,
    events: HeterogeneousAgentEvent[],
  ): HeterogeneousAgentEvent[] {
    if (!raw || typeof raw !== 'object') return events;
    const frame = raw as { is_error?: unknown; result?: unknown; type?: unknown };
    if (frame.type !== 'result' || frame.is_error === true) return events;
    if (typeof frame.result !== 'string' || !frame.result.trim()) return events;

    // Anything already visible in this batch means the stream carried the text.
    if (events.some((e) => e.type === 'stream_chunk')) return events;

    const self = this as unknown as { streamedTextByMessageId?: Map<string, string> };
    const streamedTexts = [...(self.streamedTextByMessageId?.values() ?? [])];
    if (streamedTexts.some((text) => text.trim().length > 0)) return events;

    // An `assistant` echo may have carried the text with no preceding delta.
    // `visibleText` tracks everything this adapter has already surfaced.
    if (this.visibleText.trim() === frame.result.trim()) return events;
    if (this.visibleText.includes(frame.result.trim())) return events;

    const chunk: HeterogeneousAgentEvent = {
      data: { chunkType: 'text', content: frame.result },
      stepIndex: events[0]?.stepIndex ?? 0,
      timestamp: Date.now(),
      type: 'stream_chunk',
    } as HeterogeneousAgentEvent;

    // Keep ordering sane: text must precede the terminal events.
    const terminalAt = events.findIndex(
      (e) => e.type === 'stream_end' || e.type === 'agent_runtime_end',
    );
    if (terminalAt < 0) return [...events, chunk];
    return [...events.slice(0, terminalAt), chunk, ...events.slice(terminalAt)];
  }

  /**
   * Doubao's `result.result` is `{type:'text', content:'…'}`, not a string.
   * The base class falls back to `JSON.stringify(result)`, which would render
   * raw JSON in the transcript. Flatten it to the plain text first.
   */
  private normalizeResultPayload(raw: unknown): unknown {
    if (!raw || typeof raw !== 'object') return raw;
    const frame = raw as { result?: unknown; type?: unknown };
    if (frame.type !== 'result' || !frame.result || typeof frame.result !== 'object') return raw;

    const payload = frame.result as { content?: unknown; type?: unknown };
    if (typeof payload.content !== 'string') return raw;
    // Only flatten the documented text block; leave anything else untouched.
    if (payload.type !== undefined && payload.type !== 'text') return raw;
    return { ...(raw as Record<string, unknown>), result: payload.content };
  }

  flush(): HeterogeneousAgentEvent[] {
    return normalizeDoubaoEvents(super.flush());
  }
}
