import { SkillsIdentifier } from '@lobechat/builtin-tool-skills';
import { WorkIdentifier } from '@lobechat/builtin-tool-work';
import { CLOUD_SANDBOX_IDENTIFIER } from '@lobechat/builtin-tools/fileEditScan';
import type { AgentWorkRunContext, CollectionWorkItem, WorkAccessScope } from '@lobechat/types';
import { COLLECTION_WORK_MAX_ITEMS, FileSource } from '@lobechat/types';
import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { FileModel } from '@/database/models/file';
import { AgentWorkError, WorkModel } from '@/database/models/work';
import { hasActiveWorkspaceMembership } from '@/database/models/workspace';
import { agentOperations, generations, messagePlugins, messages } from '@/database/schemas';
import type { LobeChatDatabase } from '@/database/type';
import type { HeteroOperationJwtClaims } from '@/libs/trpc/utils/internalJwt';
import { FileService } from '@/server/services/file';
import {
  HeteroOperationPrincipalError,
  resolveActiveHeteroOperationPrincipal,
} from '@/server/services/heterogeneousAgent/operationPrincipal';
import { resolveHeteroRunShareVisitor } from '@/server/services/heterogeneousAgent/shareVisitor';

import { resolveRunWorkAccessScope } from './shareWorkScope';

/** Why a run may not register Works; `status` follows HTTP semantics. */
export class AgentWorkRunError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403 | 404 | 409,
  ) {
    super(message);
    this.name = 'AgentWorkRunError';
  }
}

/** Deepest parent chain walked; operation trees are a few levels deep. */
const MAX_OPERATION_DEPTH = 10;

/**
 * The top of the operation tree a run belongs to. Run completion fills the
 * cost of agent-written versions by the root operation id, so a sub-agent's
 * `lh work` call must stamp the root, not its own operation. Authorization
 * stays bound to the operation the caller named.
 */
const resolveRootOperationId = async (
  db: LobeChatDatabase,
  start: { operationId: string; parentOperationId: string | null; userId: string },
): Promise<string> => {
  let rootId = start.operationId;
  let parentId = start.parentOperationId;
  for (let depth = 0; parentId && depth < MAX_OPERATION_DEPTH; depth += 1) {
    const [parent] = await db
      .select({ id: agentOperations.id, parentOperationId: agentOperations.parentOperationId })
      .from(agentOperations)
      .where(and(eq(agentOperations.id, parentId), eq(agentOperations.userId, start.userId)))
      .limit(1);
    if (!parent) break;
    rootId = parent.id;
    parentId = parent.parentOperationId;
  }
  return rootId;
};

export interface AgentWorkRun {
  run: AgentWorkRunContext;
  workModel: WorkModel;
  workspaceId?: string;
}

/**
 * Resolve the running operation an `lh work` call belongs to, and the Work
 * scope it writes under. The topic, agent and share scope always come from the
 * operation row, never from the CLI.
 *
 * Two callers are accepted:
 * - A run's operation token (device, gateway and sandbox heterogeneous runs),
 *   which must carry `work:write` and name this operation.
 * - A user session naming one of its own operations: the cloud sandbox `lh`
 *   shim of a LobeHub agent run, or a logged-in device.
 */
export const resolveAgentWorkRun = async (params: {
  auth: { heteroAuthKind: string; heteroOperation?: HeteroOperationJwtClaims | null };
  db: LobeChatDatabase;
  operationId: string;
  userId: string;
}): Promise<AgentWorkRun> => {
  const { auth, db, operationId } = params;

  let userId: string;
  if (auth.heteroAuthKind === 'operation') {
    if (!auth.heteroOperation) throw new AgentWorkRunError('Invalid operation token', 401);
    try {
      ({ userId } = await resolveActiveHeteroOperationPrincipal({
        capability: 'work:write',
        claims: auth.heteroOperation,
        db,
        operationId,
      }));
    } catch (error) {
      if (!(error instanceof HeteroOperationPrincipalError)) throw error;
      throw new AgentWorkRunError(error.message, error.status);
    }
  } else if (auth.heteroAuthKind === 'user') {
    userId = params.userId;
  } else {
    throw new AgentWorkRunError('This token cannot register Works', 401);
  }

  const [operation] = await db
    .select({
      agentId: agentOperations.agentId,
      parentOperationId: agentOperations.parentOperationId,
      status: agentOperations.status,
      threadId: agentOperations.threadId,
      topicId: agentOperations.topicId,
      userId: agentOperations.userId,
      workspaceId: agentOperations.workspaceId,
    })
    .from(agentOperations)
    .where(eq(agentOperations.id, operationId))
    .limit(1);

  if (!operation || operation.userId !== userId) {
    throw new AgentWorkRunError(`Operation ${operationId} not found`, 404);
  }
  if (operation.status !== 'running') {
    throw new AgentWorkRunError('Operation has already ended', 409);
  }
  if (!operation.topicId) {
    throw new AgentWorkRunError('Operation has no conversation to attach Works to', 409);
  }
  const workspaceId = operation.workspaceId ?? undefined;
  if (
    auth.heteroAuthKind === 'user' &&
    workspaceId &&
    !(await hasActiveWorkspaceMembership(db, { userId, workspaceId }))
  ) {
    throw new AgentWorkRunError('Workspace membership is no longer active', 403);
  }

  const shareVisitor = await resolveHeteroRunShareVisitor({
    db,
    operationId,
    topicId: operation.topicId,
  });
  const accessScope: WorkAccessScope | null | undefined = resolveRunWorkAccessScope({
    shareVisitor,
    topicId: operation.topicId,
  });
  // `resolveRunWorkAccessScope` returns null only for a share run without a
  // topic, which the check above already rules out.
  if (accessScope === null) throw new AgentWorkRunError('Share run has no topic', 409);

  return {
    run: {
      agentId: operation.agentId,
      operationId,
      rootOperationId: await resolveRootOperationId(db, {
        operationId,
        parentOperationId: operation.parentOperationId,
        userId,
      }),
      threadId: operation.threadId,
      topicId: operation.topicId,
      userId,
    },
    workModel: new WorkModel(db, userId, workspaceId, accessScope),
    workspaceId,
  };
};

/**
 * The version metadata of an uploaded file, read from its file row. The CLI
 * names only the file id: the size, type and URL a Work card opens come from
 * the server, never from the agent.
 *
 * Only a file the caller uploaded as run output (`lh work` uploads with the
 * `tool-result` source) qualifies: a workspace member can see teammates'
 * files, and registering one would claim it as this run's output.
 */
export const resolveAgentWorkFile = async (params: {
  db: LobeChatDatabase;
  fileId: string;
  userId: string;
  workspaceId?: string;
}): Promise<{ fileId: string; fileSize: number; fileUrl: string; mimeType: string }> => {
  const { db, fileId, userId, workspaceId } = params;
  const file = await new FileModel(db, userId, workspaceId).findById(fileId);
  if (!file || file.userId !== userId || file.source !== FileSource.ToolResult) {
    throw new AgentWorkRunError(`File ${fileId} not found`, 404);
  }

  return {
    fileId: file.id,
    fileSize: file.size,
    fileUrl: await new FileService(db, userId, workspaceId).getFileAccessUrl(file),
    mimeType: file.fileType,
  };
};

/** Sources of the images a collection may hold: generated images and run outputs. */
const COLLECTION_IMAGE_SOURCES = new Set<string>([
  FileSource.ImageGeneration,
  FileSource.ToolResult,
]);

/**
 * The id an agent names a collection image by: the `generationId` (`gen_…`) an
 * image generation result lists, a bare `file_…` id, or a `/f/<id>` file link.
 */
export const parseCollectionImageRef = (ref: string): string => {
  const value = ref.trim();
  const isAbsolute = /^https?:\/\//i.test(value);
  // A relative `/f/<id>` link is what a chat message renders for a stored file.
  if (!isAbsolute && !value.startsWith('/')) return value;
  try {
    const { pathname } = isAbsolute ? new URL(value) : new URL(value, 'https://relative.invalid');
    const match = /^\/f\/([^/]+)\/?$/.exec(pathname);
    if (match) return decodeURIComponent(match[1]);
  } catch {
    // Fall through to the error below.
  }
  throw new AgentWorkRunError(`${value} is not a LobeHub file link (/f/<file id>)`, 404);
};

const isGenerationId = (id: string) => id.startsWith('gen_');

/**
 * Resolve the images of a collection to stored image entries. Each must be an
 * image of the run's user; the URL the card shows comes from the file row,
 * never from the agent.
 *
 * Generated images and run outputs qualify as they are. Any other image of the
 * user qualifies only when a successful sandbox `exportFile` call of the run's
 * conversation produced it: the cloud sandbox stores its exports without a
 * source, and the agent must not claim the user's library uploads by id. The
 * proof is the `fileId` the server wrote to that call's state, never message
 * text, which any tool can echo (this tool's own "not found" included).
 *
 * A share visitor's run executes as the creator, so there every generated
 * image or run output must also appear in a tool result of the visitor's
 * conversation: a visitor cannot pull the creator's other images into a card
 * by guessing their ids.
 */
export const resolveAgentWorkCollectionItems = async (params: {
  db: LobeChatDatabase;
  items: { caption?: string; image: string }[];
  /** Whether the run is a share visitor's, which requires the proof for every image. */
  shareVisitor?: boolean;
  /** The run's conversation, whose tool results prove where an image came from. */
  topicId?: string;
  userId: string;
  workspaceId?: string;
}): Promise<CollectionWorkItem[]> => {
  const { db, items, shareVisitor, topicId, userId, workspaceId } = params;
  // Check the count before resolving: every item costs file (and generation)
  // queries, so an oversized list is refused before any of them run.
  if (items.length === 0) {
    throw new AgentWorkError('BAD_REQUEST', 'A collection needs at least one image');
  }
  if (items.length > COLLECTION_WORK_MAX_ITEMS) {
    throw new AgentWorkError(
      'BAD_REQUEST',
      `A collection holds at most ${COLLECTION_WORK_MAX_ITEMS} images`,
    );
  }
  const fileModel = new FileModel(db, userId, workspaceId);
  const fileService = new FileService(db, userId, workspaceId);

  const files = await Promise.all(
    items.map(async ({ caption, image }) => {
      const ref = parseCollectionImageRef(image);
      let fileId = ref;
      if (isGenerationId(ref)) {
        // Image generation results name the generation; its stored image is the file.
        const [generation] = await db
          .select({ fileId: generations.fileId })
          .from(generations)
          .where(and(eq(generations.id, ref), eq(generations.userId, userId)))
          .limit(1);
        if (!generation?.fileId) throw new AgentWorkRunError(`Image ${image} not found`, 404);
        fileId = generation.fileId;
      }
      const file = await fileModel.findById(fileId);
      if (!file || file.userId !== userId) {
        throw new AgentWorkRunError(`Image ${image} not found`, 404);
      }
      if (!file.fileType.startsWith('image/')) {
        throw new AgentWorkRunError(`File ${fileId} is not an image`, 409);
      }
      const exported = !COLLECTION_IMAGE_SOURCES.has(file.source ?? '');
      return { caption, exported, file, image, ref };
    }),
  );

  const exports = files.filter(({ exported }) => exported);
  if (exports.length > 0) {
    if (!topicId) throw new AgentWorkRunError(`Image ${exports[0].image} not found`, 404);
    const exportCalls = await db
      .select({ fileId: sql<string>`${messagePlugins.state} ->> 'fileId'` })
      .from(messagePlugins)
      .innerJoin(messages, eq(messages.id, messagePlugins.id))
      .where(
        and(
          eq(messages.topicId, topicId),
          eq(messages.userId, userId),
          eq(messagePlugins.apiName, 'exportFile'),
          inArray(messagePlugins.identifier, [CLOUD_SANDBOX_IDENTIFIER, SkillsIdentifier]),
          inArray(
            sql`${messagePlugins.state} ->> 'fileId'`,
            exports.map(({ file }) => file.id),
          ),
        ),
      );
    const missing = exports.find(
      ({ file }) => !exportCalls.some((call) => call.fileId === file.id),
    );
    if (missing) throw new AgentWorkRunError(`Image ${missing.image} not found`, 404);
  }

  const shownToVisitor = files.filter(({ exported }) => shareVisitor && !exported);
  if (shownToVisitor.length > 0) {
    if (!topicId) throw new AgentWorkRunError(`Image ${shownToVisitor[0].image} not found`, 404);
    // Generated images live in generation topics; the conversation only holds
    // the id the agent names them by (the generation id or file link) in the
    // tool result that produced them. One scan of the topic returns the
    // messages naming any of the images.
    const shown = await db
      .select({
        content: messages.content,
        identifier: messagePlugins.identifier,
        role: messages.role,
      })
      .from(messages)
      .leftJoin(messagePlugins, eq(messagePlugins.id, messages.id))
      .where(
        and(
          eq(messages.topicId, topicId),
          eq(messages.userId, userId),
          or(...shownToVisitor.map(({ ref }) => sql`position(${ref} in ${messages.content}) > 0`)),
        ),
      );
    // Only tool results count: a message the visitor typed, or an assistant
    // reply echoing it, can name any id the visitor guessed. So can this tool's
    // own refusal ("Image <id> not found"), which a retry would otherwise read
    // as proof.
    const toolResults = shown.filter(
      ({ identifier, role }) => role === 'tool' && identifier !== WorkIdentifier,
    );
    const missing = shownToVisitor.find(
      ({ ref }) => !toolResults.some(({ content }) => content?.includes(ref)),
    );
    if (missing) throw new AgentWorkRunError(`Image ${missing.image} not found`, 404);
  }

  return Promise.all(
    files.map(async ({ caption, file }) => ({
      ...(caption?.trim() ? { caption: caption.trim() } : {}),
      fileId: file.id,
      mimeType: file.fileType,
      url: await fileService.getFileAccessUrl(file),
    })),
  );
};
