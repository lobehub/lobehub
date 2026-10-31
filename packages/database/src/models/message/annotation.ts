import type { ChatTranslate, ChatTTS, UpdateMessageRAGParams } from '@lobechat/types';
import { and, eq } from 'drizzle-orm';

import {
  messageQueries,
  messageQueryChunks,
  messagesFiles,
  messageTranslates,
  messageTTS,
} from '../../schemas';
import { buildWorkspaceWhere } from '../../utils/workspace';
import type { MessageLookupQueries } from './lookup';
import type { MessageScopeArgs } from './scope';
import { MessageScope } from './scope';

export class MessageAnnotationMutations extends MessageScope {
  private readonly lookups: MessageLookupQueries;

  constructor(args: MessageScopeArgs, deps: { lookups: MessageLookupQueries }) {
    super(...args);
    this.lookups = deps.lookups;
  }

  updateTranslate = async (id: string, translate: Partial<ChatTranslate>) => {
    const result = await this.db.query.messageTranslates.findFirst({
      where: and(eq(messageTranslates.id, id), this.translatesOwnership()),
    });

    // If the message does not exist in the translate table, insert it
    if (!result) {
      return this.db.insert(messageTranslates).values({
        ...translate,
        id,
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      });
    }

    // or just update the existing one
    return this.db
      .update(messageTranslates)
      .set(translate)
      .where(and(eq(messageTranslates.id, id), this.translatesOwnership()));
  };

  updateTTS = async (id: string, tts: Partial<ChatTTS>) => {
    const { contentMd5, file, voice } = tts;
    // Older clients sent an empty payload when starting TTS, so keep this backward-compatible.
    if ([contentMd5, file, voice].every((value) => value === undefined)) return;

    const result = await this.db.query.messageTTS.findFirst({
      where: and(eq(messageTTS.id, id), this.ttsOwnership()),
    });

    // If the message does not exist in the TTS table, insert it
    if (!result) {
      return this.db.insert(messageTTS).values({
        contentMd5,
        fileId: file,
        id,
        userId: this.userId,
        voice,
        workspaceId: this.workspaceId ?? null,
      });
    }

    // or just update the existing one
    return this.db
      .update(messageTTS)
      .set({ contentMd5, fileId: file, voice })
      .where(and(eq(messageTTS.id, id), this.ttsOwnership()));
  };

  async updateMessageRAG(id: string, { ragQueryId, fileChunks }: UpdateMessageRAGParams) {
    return this.db.insert(messageQueryChunks).values(
      fileChunks.map((chunk) => ({
        chunkId: chunk.id,
        messageId: id,
        queryId: ragQueryId,
        similarity: chunk.similarity?.toString(),
        userId: this.userId,
        workspaceId: this.workspaceId ?? null,
      })),
    );
  }

  /**
   * Add files to a message by inserting records into messagesFiles table
   * This associates existing files with a message for display in fileList/imageList/videoList
   */
  addFiles = async (messageId: string, fileIds: string[]): Promise<{ success: boolean }> => {
    if (fileIds.length === 0) return { success: true };

    // The insert below has no ownership predicate of its own, so verify the
    // target message is actually visible to this user/workspace first —
    // otherwise a caller could attach files to another tenant's message.
    const message = await this.lookups.findById(messageId);
    if (!message) return { success: false };

    try {
      await this.db.insert(messagesFiles).values(
        fileIds.map((fileId) => ({
          fileId,
          messageId,
          userId: this.userId,
          workspaceId: this.workspaceId ?? null,
        })),
      );
      return { success: true };
    } catch (error) {
      console.error('Add files to message error:', error);
      return { success: false };
    }
  };

  deleteMessageTranslate = async (id: string) =>
    this.db
      .delete(messageTranslates)
      .where(and(eq(messageTranslates.id, id), this.translatesOwnership()));

  deleteMessageTTS = async (id: string) =>
    this.db.delete(messageTTS).where(and(eq(messageTTS.id, id), this.ttsOwnership()));

  deleteMessageQuery = async (id: string) =>
    this.db
      .delete(messageQueries)
      .where(
        and(
          eq(messageQueries.id, id),
          buildWorkspaceWhere(
            { userId: this.userId, workspaceId: this.workspaceId },
            messageQueries,
          ),
        ),
      );
}
