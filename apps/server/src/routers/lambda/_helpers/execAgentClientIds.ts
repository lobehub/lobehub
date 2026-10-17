import { entityIdPattern } from '@lobechat/types';
import { z } from 'zod';

/**
 * Client-minted ids for the rows an `execAgent` run creates, honoured verbatim —
 * the gateway counterpart of `sendMessageInServer`'s `newTopic.id` /
 * `newUserMessage.id` / `newAssistantMessage.id`. Validated per namespace: an
 * unvalidated client primary key would let a caller submit look-alike ids,
 * wrong namespaces, or strings that leak into logs and URLs.
 *
 * Shared by the owner (`aiAgent.execAgent`) and agent-share visitor
 * (`shareChat.execAgent`) entry points so both accept the same fields.
 */
export const execAgentClientIdsSchema = z
  .object({
    assistantMessageId: z.string().regex(entityIdPattern('messages')).optional(),
    topicId: z.string().regex(entityIdPattern('topics')).optional(),
    userMessageId: z.string().regex(entityIdPattern('messages')).optional(),
    /**
     * Tail of the branch the client renders the new user turn under. A reference
     * to an existing row, not a minted id: rows written in client mode carry bare
     * nanoid ids, so only bound the length and let the resolver check that it
     * belongs to this topic and thread.
     */
    userMessageParentId: z.string().min(1).max(255).optional(),
  })
  .optional();
