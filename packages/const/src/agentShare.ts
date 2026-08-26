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
