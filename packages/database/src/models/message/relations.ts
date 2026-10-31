import type { TaskDetail, ThreadStatus, WorkAccessScope, WorkSummaryItem } from '@lobechat/types';
import { logTimingSink as logTiming, runTimedSinkStage as runTimedStage } from '@lobechat/utils';
import { and, eq, inArray } from 'drizzle-orm';
import pMap from 'p-map';

import {
  chunks,
  documents,
  fileChunks,
  files,
  messageQueries,
  messageQueryChunks,
  messagesFiles,
  threads,
} from '../../schemas';
import { notFileBackedPlaceholder } from '../../utils/fileBackedPlaceholder';
import { buildWorkspaceWhere } from '../../utils/workspace';
import { WorkModel } from '../work';
import type { FileDocumentsMap, MessageRelatedFile } from './attachments';
import {
  FILE_URL_POST_PROCESS_CONCURRENCY,
  fileDocumentColumns,
  fileDocumentsOrder,
  getMessageWorkRootId,
  toFileDocumentsMap,
} from './attachments';
import { MessageScope } from './scope';
import type { ModelTimingContext, QueryMessagesOptions } from './types';

interface MessageChunkRelation {
  fileId: string;
  filename: string | null;
  fileType: string | null;
  fileUrl: string | null;
  id: string | null;
  messageId: string | null;
  similarity: string | null;
  text: string | null;
}

interface MessageQueryRelation {
  id: string;
  messageId: string;
  rewriteQuery: string | null;
  userQuery: string | null;
}

interface MessageThreadRelation {
  metadata: unknown;
  sourceMessageId: string | null;
  status: string | null;
  threadId: string;
  title: string | null;
}

interface MessageFileRelations {
  documentsMap: FileDocumentsMap;
  relatedFileList: MessageRelatedFile[];
}

export class MessageRelationQueries extends MessageScope {
  queryMessageFileRelations = async (
    messageIds: string[],
    postProcessUrl: QueryMessagesOptions['postProcessUrl'],
    timing?: ModelTimingContext,
  ): Promise<MessageFileRelations> => {
    if (messageIds.length === 0) return { documentsMap: {}, relatedFileList: [] };

    const rawRelatedFileList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.relatedFiles.select',
      () =>
        this.db
          .select({
            fileType: files.fileType,
            id: messagesFiles.fileId,
            messageId: messagesFiles.messageId,
            metadata: files.metadata,
            name: files.name,
            size: files.size,
            url: files.url,
          })
          .from(messagesFiles)
          // Guard the referenced file, not just the relation: in a shared
          // conversation (chat group / workspace task) the message is visible
          // to every member, but a file its owner switched back to private
          // must degrade to a tombstone (id only) instead of leaking
          // name/size/url. Same anti-leak join pattern as the agent knowledge
          // reads in agent.ts.
          .leftJoin(
            files,
            and(
              eq(files.id, messagesFiles.fileId),
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
            ),
          )
          .where(inArray(messagesFiles.messageId, messageIds)),
      { messageCount: messageIds.length },
    );
    logTiming(timing, 'db.message.queryWithWhere.relatedFiles.select:rows', {
      rowCount: rawRelatedFileList.length,
    });

    const relatedFileList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.relatedFiles.postProcess',
      () =>
        pMap(
          rawRelatedFileList,
          async (file) => {
            // Tombstoned by the visibility guard above — nothing to presign.
            if (file.name === null) return { ...file, url: '' };
            return {
              ...file,
              url: postProcessUrl
                ? await postProcessUrl(
                    file.url,
                    file as unknown as { fileType: string; id?: string | null },
                  )
                : (file.url as string),
            };
          },
          { concurrency: FILE_URL_POST_PROCESS_CONCURRENCY },
        ),
      { fileCount: rawRelatedFileList.length },
    );

    // Exclude tombstoned files — their parsed document content must not leak
    // through the unguarded documents join below.
    const fileIds = relatedFileList
      .filter((file) => file.name !== null)
      .map((file) => file.id)
      .filter(Boolean);

    if (fileIds.length === 0) return { documentsMap: {}, relatedFileList };

    const documentsList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.documents.select',
      () =>
        this.db
          .select(fileDocumentColumns)
          .from(documents)
          .where(and(inArray(documents.fileId, fileIds), notFileBackedPlaceholder()))
          .orderBy(...fileDocumentsOrder),
      { fileCount: fileIds.length },
    );

    const documentsMap = toFileDocumentsMap(documentsList);

    return { documentsMap, relatedFileList };
  };

  queryMessageChunkRelations = async (
    messageIds: string[],
    timing?: ModelTimingContext,
  ): Promise<MessageChunkRelation[]> => {
    if (messageIds.length === 0) return [];

    const chunksList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.chunks.select',
      () =>
        this.db
          .select({
            fileId: files.id,
            fileType: files.fileType,
            fileUrl: files.url,
            filename: files.name,
            id: chunks.id,
            messageId: messageQueryChunks.messageId,
            similarity: messageQueryChunks.similarity,
            text: chunks.text,
          })
          .from(messageQueryChunks)
          .leftJoin(chunks, eq(chunks.id, messageQueryChunks.chunkId))
          .leftJoin(fileChunks, eq(fileChunks.chunkId, chunks.id))
          // Guard the referenced file like queryMessageFileRelations: in a
          // shared conversation, RAG reference chunks of a file its owner
          // switched back to private must not leak filename/url/text to other
          // members. The inner join drops those chunk rows entirely.
          .innerJoin(
            files,
            and(
              eq(fileChunks.fileId, files.id),
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, files),
            ),
          )
          .where(inArray(messageQueryChunks.messageId, messageIds)),
      { messageCount: messageIds.length },
    );
    logTiming(timing, 'db.message.queryWithWhere.chunks.select:rows', {
      rowCount: chunksList.length,
    });

    return chunksList;
  };

  /**
   * Resolve Work summaries for a page of messages and key them by anchor
   * message id — the LAST message (rows are createdAt-asc, so last occurrence)
   * carrying each `metadata.work.rootOperationId`. Works ride the message-list
   * payload so the in-message Works chips and the sidebar summary read from one
   * source instead of a dedicated work-summary fetch. Attaching only to the
   * round's last message (not every row sharing the operation) keeps the
   * payload flat — the client re-keys by `rootOperationId`, so which row
   * physically carries it doesn't matter.
   */
  queryMessageWorkSummaries = async (
    rows: { id: unknown; metadata: unknown }[],
    includeFileWorks?: boolean,
    timing?: ModelTimingContext,
    workAccessScope?: WorkAccessScope,
  ): Promise<Record<string, WorkSummaryItem[]>> => {
    const anchorByRootId = new Map<string, string>();
    for (const row of rows) {
      const rootOperationId = getMessageWorkRootId(row.metadata);
      if (rootOperationId) anchorByRootId.set(rootOperationId, row.id as string);
    }
    if (anchorByRootId.size === 0) return {};

    const summaryMap = await runTimedStage(
      timing,
      'db.message.queryWithWhere.workSummaries',
      () =>
        new WorkModel(
          this.db,
          this.userId,
          this.workspaceId,
          workAccessScope,
        ).listSummariesByRootOperations({
          includeFileWorks,
          rootOperationIds: Array.from(anchorByRootId.keys()),
        }),
      { rootOperationCount: anchorByRootId.size },
    );

    const worksByMessageId: Record<string, WorkSummaryItem[]> = {};
    for (const [rootOperationId, messageId] of anchorByRootId) {
      const works = summaryMap[rootOperationId];
      if (works && works.length > 0) worksByMessageId[messageId] = works;
    }
    logTiming(timing, 'db.message.queryWithWhere.workSummaries:rows', {
      messageCount: Object.keys(worksByMessageId).length,
    });
    return worksByMessageId;
  };

  queryMessageQueryRelations = async (
    messageIds: string[],
    timing?: ModelTimingContext,
  ): Promise<MessageQueryRelation[]> => {
    if (messageIds.length === 0) return [];

    const messageQueriesList = await runTimedStage(
      timing,
      'db.message.queryWithWhere.messageQueries.select',
      () =>
        this.db
          .select({
            id: messageQueries.id,
            messageId: messageQueries.messageId,
            rewriteQuery: messageQueries.rewriteQuery,
            userQuery: messageQueries.userQuery,
          })
          .from(messageQueries)
          .where(inArray(messageQueries.messageId, messageIds)),
      { messageCount: messageIds.length },
    );
    logTiming(timing, 'db.message.queryWithWhere.messageQueries.select:rows', {
      rowCount: messageQueriesList.length,
    });

    return messageQueriesList;
  };

  queryMessageThreadRelations = async (
    taskMessageIds: string[],
    timing?: ModelTimingContext,
  ): Promise<MessageThreadRelation[]> => {
    if (taskMessageIds.length === 0) return [];

    return runTimedStage(
      timing,
      'db.message.queryWithWhere.taskThreads.select',
      () =>
        this.db
          .select({
            metadata: threads.metadata,
            sourceMessageId: threads.sourceMessageId,
            status: threads.status,
            threadId: threads.id,
            title: threads.title,
          })
          .from(threads)
          .where(
            and(
              buildWorkspaceWhere({ userId: this.userId, workspaceId: this.workspaceId }, threads),
              inArray(threads.sourceMessageId, taskMessageIds),
            ),
          ),
      { taskMessageCount: taskMessageIds.length },
    );
  };

  createThreadMap = (threadData: MessageThreadRelation[]) =>
    new Map<string, TaskDetail>(
      threadData.map((thread) => {
        const metadata = thread.metadata as Record<string, unknown> | null;
        return [
          thread.sourceMessageId!,
          {
            clientMode: metadata?.clientMode as boolean | undefined,
            duration: metadata?.duration as number | undefined,
            status: thread.status as ThreadStatus,
            threadId: thread.threadId,
            title: thread.title ?? undefined,
            totalCost: metadata?.totalCost as number | undefined,
            totalMessages: metadata?.totalMessages as number | undefined,
            totalTokens: metadata?.totalTokens as number | undefined,
            totalToolCalls: metadata?.totalToolCalls as number | undefined,
          },
        ];
      }),
    );
}
