/**
 * Sanitize history `thinking` content parts for third-party Anthropic-compatible
 * endpoints (DeepSeek / Moonshot / Kimi / MiniMax).
 *
 * The context engine replays assistant reasoning as Anthropic `thinking` content
 * parts, and history may carry signature-only reasoning (e.g. Claude 5
 * `thinking.display: 'omitted'`), whose `thinking: undefined` disappears entirely
 * on JSON serialization. Third-party endpoints have their own thinking contracts:
 *
 * - DeepSeek deserializes strictly and rejects a thinking part without the
 *   `thinking` field with 400 `missing field 'thinking'`.
 * - Thinking signatures are provider-specific (Claude long base64 vs DeepSeek
 *   UUID-like) and are not verifiable across providers, so they must not be
 *   forwarded. This mirrors `normalizeClaudeThinkingHistoryMessages`, which
 *   protects the Claude side of the same boundary.
 *
 * Rules:
 * - keep thinking text but never forward `signature` — these endpoints accepted
 *   unsigned thinking blocks long before signatures were ever persisted
 * - drop thinking parts without non-empty thinking text — callers' placeholder
 *   logic (`{ thinking: ' ' }`) guarantees a block when the API requires one,
 *   and an empty-string `thinking` has never been validated against these APIs
 * - drop `redacted_thinking` parts — they are Claude-encrypted and meaningless
 *   to other providers
 */
export const sanitizeAnthropicThinkingParts = (content: any[]): any[] =>
  content
    .map((part) => {
      if (part?.type === 'redacted_thinking') return undefined;
      if (part?.type !== 'thinking') return part;

      const thinking = typeof part.thinking === 'string' ? part.thinking : '';
      if (!thinking) return undefined;

      return { thinking, type: 'thinking' as const };
    })
    .filter((part) => part !== undefined);
