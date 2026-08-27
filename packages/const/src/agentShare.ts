/**
 * Upper bound for `AgentShareConfig.maxTopicsPerVisitor`.
 *
 * This mirrors the visitor topic list page size (`TopicModel.queryBySender`
 * has no cursor): a higher cap would let a visitor create topics the list
 * can never show again. Kept in `@lobechat/const` (instead of
 * `packages/database`) so both the server schema and the settings UI can
 * import it without pulling drizzle into the client bundle.
 */
export const AGENT_SHARE_MAX_TOPICS_PER_VISITOR = 50;

/**
 * Upper bound on a visitor-submitted `prompt` for `shareChat.execAgent`.
 *
 * Unlike `aiAgent.execAgent` (the owner's own account, so oversized input is
 * self-inflicted), `shareChat.execAgent` runs as the CREATOR:
 * `AiAgentService.execAgent` persists the text verbatim into creator-owned
 * messages before the topic/turn caps in `shareChat.ts` even run (they gate
 * request COUNT, not per-request SIZE). Without a size bound, any
 * authenticated visitor with a live link could submit
 * HTTP-infrastructure-limit-sized prompts on repeat, bloating the creator's
 * message rows and risking the documented 10 MB Upstash gateway-payload
 * limit on a single turn.
 *
 * 20,000 characters (~5-8k tokens for typical English/code text) comfortably
 * covers legitimate long-form asks (pasted code, long questions) while
 * keeping a single turn's contribution to that 10 MB budget negligible.
 *
 * Kept in `@lobechat/const` (instead of inline in `shareChat.ts`) so both the
 * server input schema and `VisitorComposer`'s client-side `maxLength`/error
 * copy share one source of truth — the server bound is still the real gate;
 * the client mirror is convenience only (see LOBE-11930 codex P2).
 */
export const SHARE_VISITOR_PROMPT_MAX_LENGTH = 20_000;
