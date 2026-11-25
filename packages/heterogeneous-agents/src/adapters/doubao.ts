/**
 * Doubao CLI Adapter
 *
 * Doubao (`doubao`, shipped as `@bytedance/doubao-cli`) speaks a Claude-shaped
 * `stream-json` dialect for its one-shot mode:
 *
 *   doubao -p - --output-format stream-json --permission-mode always_allow
 *
 * Frames captured from v2.38.2, one tool round-trip plus the answer:
 *
 *   {type: 'system', subtype: 'init', session_id}
 *   {type: 'assistant', message: {id: '<n>:tool_use:<uuid>', content: [tool_use]}}
 *   {type: 'user', message: {id: '<n>:tool_result:<uuid>', content: [tool_result]}}
 *   {type: 'stream_event', message_id: '<n>', event: {type: 'content_block_delta', delta: {type: 'text_delta', text}}}
 *   {type: 'assistant', message: {id: '<n>', content: [{type: 'text', text}]}}
 *   {type: 'result', result: {type: 'text', content: '<answer>'}}
 *
 * Because the envelope is Claude's, the shared `ClaudeCompatibleStreamAdapter`
 * owns the state machine and this adapter only encodes where Doubao differs:
 *
 * - **No `message_start`.** The delta flow's id rides on the `stream_event`
 *   wrapper (`message_id`), not on `event.message.id`. See
 *   `resolveStreamEventMessageId` — without it the deltas are never buffered
 *   and the trailing full-text `assistant` echo repeats the whole answer.
 * - **Namespaced item ids.** Tool items are `<response>:tool_use:<uuid>` /
 *   `<response>:tool_result:<uuid>` while the answer is the bare `<response>`,
 *   so an id change is NOT a turn boundary (`assistantMessageIdsDefineTurns:
 *   false`, same as CodeBuddy). Only the bare id is the model response.
 * - **`result.result` is an object.** `{type: 'text', content}` instead of a
 *   string; `adapt` unwraps it so terminal classifiers read the failure text
 *   rather than JSON.
 * - **Tool-result content is an array** of `{type: 'text', text}` blocks. The
 *   base `handleUser` already flattens that shape.
 * - **No usage, no model id.** Neither `init` nor `result` reports one, so
 *   this adapter emits no `turn_metadata` usage events and `stream_start`
 *   carries no model. Anything shown as a model id has to come from the
 *   selection the caller persisted, not from the stream.
 *
 * Its Chinese failure strings (`auth_unavailable: …`,
 * `service_unavailable: …`) match none of the Claude-specific classifiers, so
 * those stay off and auth is classified through the descriptor patterns.
 */

import { getHeterogeneousAgentConfigOrThrow } from '../config';
import type { HeterogeneousAgentEvent } from '../types';
import { type ClaudeCompatibleAdapterProfile, ClaudeCompatibleStreamAdapter } from './claudeCode';

const doubaoDescriptor = getHeterogeneousAgentConfigOrThrow('doubao');

const DOUBAO_ADAPTER_PROFILE: ClaudeCompatibleAdapterProfile = {
  agentType: 'doubao',
  // `<n>:tool_use:<uuid>` / `<n>:tool_result:<uuid>` are content-item ids; the
  // bare `<n>` is the response they belong to. Treating an item id as a turn
  // would split one answer across several assistants.
  assistantMessageIdsDefineTurns: false,
  authMessage: doubaoDescriptor.auth.errorMessage,
  authRequiredPatterns: doubaoDescriptor.auth.patterns.map(
    (pattern) => new RegExp(pattern, 'i'),
  ),
  docsUrl: doubaoDescriptor.auth.docsUrl,
  // Doubao reports its own device-state failures in Chinese. None of the
  // Claude classifiers match them, and widening those regexes would file a
  // local `~/.local/share/doubao_cli` problem as a provider outage.
  enableClaudeErrorClassifiers: false,
  // No TodoWrite / Task* tool surface was observed on the wire; Doubao's task
  // state lives in its own sandbox, not in a tool the adapter could mirror.
  enableClaudeTaskState: false,
  // Only the `success` subtype was observed. Unknown subtypes fall back to the
  // generic error card instead of a guessed Chinese reason.
  errorSubtypeMessages: {},
  ignoreDuplicateInit: true,
};

/** Doubao's terminal `result` payload: `{type: 'text', content: '<answer>'}`. */
const isDoubaoTextResult = (
  value: unknown,
): value is { content: string; type: 'text' } =>
  !!value &&
  typeof value === 'object' &&
  (value as { type?: unknown }).type === 'text' &&
  typeof (value as { content?: unknown }).content === 'string';

export class DoubaoAdapter extends ClaudeCompatibleStreamAdapter {
  constructor() {
    super({}, DOUBAO_ADAPTER_PROFILE);
  }

  /**
   * Doubao never sends `message_start`, so the delta flow would otherwise have
   * no id: `streamedTextByMessageId` stays empty, the trailing `assistant`
   * echo sees no streamed prefix and re-emits the entire answer. The wrapper's
   * `message_id` is the same bare id the echo carries, which is what makes the
   * dedupe — and the turn boundary — line up.
   */
  protected resolveStreamEventMessageId(raw: any): string | undefined {
    const messageId = raw?.message_id;
    return typeof messageId === 'string' && messageId ? messageId : undefined;
  }

  /**
   * The base handler stringifies an unknown `result.result`, which would feed
   * `{"type":"text","content":"…"}` to the auth classifiers and to the error
   * card. Unwrap the text first so a failed run reports what Doubao said.
   */
  adapt(raw: any): HeterogeneousAgentEvent[] {
    if (raw?.type === 'result' && isDoubaoTextResult(raw.result)) {
      return super.adapt({ ...raw, result: raw.result.content });
    }

    return super.adapt(raw);
  }
}
