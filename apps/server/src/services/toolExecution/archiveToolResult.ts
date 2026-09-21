import { createHash } from 'node:crypto';

import type { LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';
import { sql } from 'drizzle-orm';

import { TopicDocumentModel } from '@/database/models/topicDocument';
import { AgentDocumentVfsService } from '@/server/services/agentDocumentVfs';
import {
  ARCHIVE_BYPASS_IDENTIFIERS,
  DEFAULT_TOOL_RESULT_MAX_LENGTH,
  truncateToolResult,
} from '@/server/utils/truncateToolResult';

import { TOOL_RESULTS_DIR_NAME } from './constants';

const log = debug('lobe-server:tool-result-archive');

const TOOL_RESULTS_DIR = `./${TOOL_RESULTS_DIR_NAME}`;
const ARCHIVE_VERIFICATION_ERROR = 'Archived content verification failed';

/**
 * Length of the content-hash prefix used as the archive filename. 32 hex chars
 * (128 bits of sha256) is far beyond any realistic collision budget for one
 * agent's archive, while keeping the path the model sees short.
 */
const ARCHIVE_HASH_LENGTH = 32;

export interface ToolResultArchiveOutcome {
  archived: boolean;
  archivePath?: string;
  content: string;
  error?: string;
}

interface ArchiveToolResultParams {
  agentId?: string | null;
  content: string;
  identifier?: string;
  limit?: number;
  serverDB?: LobeChatDatabase;
  toolCallId?: string;
  topicId?: string | null;
  userId?: string;
  workspaceId?: string;
}

interface ArchiveHandle {
  agentDocumentId?: string;
  archivePath: string;
  documentId?: string;
  outcome: 'created' | 'reused' | 'collision';
}

/**
 * Archives are keyed by content hash rather than by `{topicId}_{toolCallId}`.
 * The same oversized tool result (typically a knowledge-base file read) recurs
 * across many topics of one agent; keying by content lets every topic bind to
 * one `documents` row instead of persisting a byte-identical copy per call.
 *
 * Trade-off: one archive row is now shared by every topic (and, in a
 * workspace, every member) that produced the same content, so trashing it
 * from one topic also breaks the `Agent Document ID` pointer persisted in the
 * other topics' tool messages. Archives are hidden from user-facing lists
 * (`excludeArchivedToolResults`), so that path is not reachable from the UI.
 */
const buildArchivePath = (contentHash: string) => `${TOOL_RESULTS_DIR}/${contentHash}.txt`;

/**
 * Fallback path when the hash-named archive already exists but holds different
 * content (hash-prefix collision or a corrupted row). Never reuse such a row.
 */
const buildCollisionArchivePath = (contentHash: string, toolCallId: string) =>
  `${TOOL_RESULTS_DIR}/${contentHash}_${toolCallId}.txt`;

const hashArchiveContent = (content: string) =>
  createHash('sha256').update(content).digest('hex').slice(0, ARCHIVE_HASH_LENGTH);

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error || 'Unknown archive error');

const buildArchivedContent = (
  truncatedContent: string,
  archivePath: string,
  agentDocumentId?: string,
) => {
  const agentDocumentIdHint =
    agentDocumentId ??
    '(call lobe-agent-documents.listDocuments with scope=currentTopic to look up)';

  return `${truncatedContent}\nFull content archived to the agent-document VFS.\nPath: ${archivePath}\nAgent Document ID: ${agentDocumentIdHint}\nTo inspect specific sections, call the lobe-agent-documents tool with apiName=readDocument and id=<Agent Document ID above>. Do NOT activate cloud-sandbox or local-system file tools — this archive exists only inside the agent document tree.`;
};

export const archiveToolResultIfNeeded = async ({
  agentId,
  content,
  identifier,
  limit,
  serverDB,
  toolCallId,
  topicId,
  userId,
  workspaceId,
}: ArchiveToolResultParams): Promise<ToolResultArchiveOutcome> => {
  if (identifier && ARCHIVE_BYPASS_IDENTIFIERS.has(identifier)) {
    return { archived: false, content };
  }

  const maxLength = limit ?? DEFAULT_TOOL_RESULT_MAX_LENGTH;

  if (!content || content.length <= maxLength) {
    return { archived: false, content };
  }

  const truncatedContent = truncateToolResult(content, maxLength);

  if (!agentId || !topicId || !toolCallId || !serverDB || !userId) {
    return { archived: false, content: truncatedContent };
  }

  const contentHash = hashArchiveContent(content);
  const archivePath = buildArchivePath(contentHash);

  try {
    const handle = await serverDB.transaction(async (tx) => {
      // `mkdir` and the hash lookup below are both read-then-write. Two tool
      // calls of one agent archiving at the same moment used to create two
      // `.tool-results` root folders (or two rows for the same content), and a
      // unique index cannot express "unique per agent" on `documents`, so
      // serialize archive writes per agent instead. `hashtext` returns int4
      // while `pg_advisory_xact_lock` takes bigint, so cast. Under READ
      // COMMITTED the lookups take a fresh snapshot once the lock is granted,
      // so they see whatever the previous holder committed.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`toolResultArchive:${agentId}`})::bigint)`,
      );

      const vfsService = new AgentDocumentVfsService(
        tx as unknown as LobeChatDatabase,
        userId,
        workspaceId,
      );
      const ctx = { agentId, topicId };

      await vfsService.mkdir(TOOL_RESULTS_DIR, ctx, { recursive: true });

      const persistArchive = async (
        path: string,
        outcome: ArchiveHandle['outcome'],
      ): Promise<ArchiveHandle> => {
        const stats = await vfsService.write(path, content, ctx, { contentFormat: 'raw' });
        const persisted = await vfsService.read(path, ctx);

        // Never tell the model that a full result exists unless the VFS can return it losslessly.
        if (persisted.content !== content) throw new Error(ARCHIVE_VERIFICATION_ERROR);

        return {
          agentDocumentId: stats.id,
          archivePath: path,
          documentId: stats.documentId,
          outcome,
        };
      };

      const resolveArchive = async (): Promise<ArchiveHandle> => {
        const existing = await vfsService.stat(archivePath, ctx);

        if (!existing || existing.type !== 'file') return persistArchive(archivePath, 'created');

        const persisted = await vfsService.read(archivePath, ctx);

        if (persisted.content === content) {
          return {
            agentDocumentId: existing.id,
            archivePath,
            documentId: existing.documentId,
            outcome: 'reused',
          };
        }

        return persistArchive(buildCollisionArchivePath(contentHash, toolCallId), 'collision');
      };

      const resolved = await resolveArchive();

      // The reuse / collision counters are what tell us whether the dedup is
      // doing its job in production; keep them greppable.
      log(
        'archive %s agent=%s topic=%s path=%s',
        resolved.outcome,
        agentId,
        topicId,
        resolved.archivePath,
      );

      if (resolved.documentId) {
        const topicDocumentModel = new TopicDocumentModel(
          tx as unknown as LobeChatDatabase,
          userId,
          workspaceId,
        );
        const associated = await topicDocumentModel.isAssociated(resolved.documentId, topicId);
        if (!associated) {
          await topicDocumentModel.associate({ documentId: resolved.documentId, topicId });
        }
      }

      return resolved;
    });

    return {
      archivePath: handle.archivePath,
      archived: true,
      content: buildArchivedContent(truncatedContent, handle.archivePath, handle.agentDocumentId),
    };
  } catch (error) {
    const message = getErrorMessage(error);

    return {
      archivePath,
      archived: false,
      content: `${truncatedContent}\n[Archive failed: ${message}. Full content was not persisted.]`,
      error: message,
    };
  }
};
