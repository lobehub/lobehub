import { WorkIdentifier, type WorkSummary } from '@lobechat/builtin-tool-work';
import {
  WorkExecutionRuntime,
  WorkToolError,
  type WorkToolService,
} from '@lobechat/builtin-tool-work/executionRuntime';
import type { AgentWorkRunContext, WorkItem } from '@lobechat/types';

import { AgentWorkError, WorkModel } from '@/database/models/work';
import {
  AgentWorkRunError,
  parseCollectionImageRef,
  resolveAgentWorkCollectionItems,
  resolveRunWorkAccessScope,
} from '@/server/services/workRegistration';

import type { ToolExecutionContext } from '../types';
import type { ServerRuntimeRegistration } from './types';

const MODEL_ERROR_CODES = {
  BAD_REQUEST: 'invalid_input',
  CONFLICT: 'conflict',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
} as const;

const RUN_ERROR_CODES = {
  401: 'unavailable',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
} as const;

/** Translate the model's and the resolver's refusals into the tool's stable codes. */
const toToolError = (error: unknown): unknown => {
  if (error instanceof AgentWorkError)
    return new WorkToolError(MODEL_ERROR_CODES[error.code], error.message);
  if (error instanceof AgentWorkRunError)
    return new WorkToolError(RUN_ERROR_CODES[error.status], error.message);
  return error;
};

const guarded =
  <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
  async (...args: A): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      throw toToolError(error);
    }
  };

const summarize = (work: WorkItem, imageCount?: number): WorkSummary => ({
  ...(imageCount === undefined ? {} : { imageCount }),
  title: work.title ?? null,
  // An external Work this tool writes is always a link; a `file` Work is one the
  // CLI created in this conversation that the agent renamed here.
  type: work.type === 'collection' || work.type === 'file' ? work.type : 'link',
  url: work.url ?? null,
  workId: work.id,
});

/**
 * The `lobe-work` tools: the agent registers collections and links it produced
 * as Works of this run. The run (conversation, operation, tool call) comes
 * from the execution context, never from the model, and the agent can change
 * only the Works it created in this conversation (`findAgentManagedWork`).
 *
 * A share visitor's run writes under the share scope pinned to the visitor's
 * topic, so its Works stay out of the creator's ordinary lists.
 */
export const createWorkToolService = (context: ToolExecutionContext): WorkToolService => {
  const { agentShareVisitor, serverDB: db, topicId, userId, workspaceId } = context;
  const operationId = context.rootOperationId ?? context.operationId;
  if (!db || !userId || !topicId || !operationId) {
    throw new WorkToolError(
      'unavailable',
      'Works can be registered only inside a conversation run',
    );
  }

  const accessScope = resolveRunWorkAccessScope({ shareVisitor: agentShareVisitor, topicId });
  // Only a share run without a topic resolves to null, and the check above
  // already requires a topic; keep the refusal so a scope change cannot leak
  // a visitor's Work into the creator's lists.
  if (accessScope === null) {
    throw new WorkToolError('unavailable', 'This shared conversation cannot register Works');
  }

  const workModel = new WorkModel(db, userId, workspaceId, accessScope);
  const run: AgentWorkRunContext = {
    agentId: context.agentId ?? null,
    messageId: context.assistantMessageId ?? null,
    operationId,
    threadId: context.threadId ?? null,
    toolCallId: context.toolCallId ?? null,
    toolIdentifier: WorkIdentifier,
    topicId,
    userId,
  };

  const resolveCollection = async (
    items: { caption?: string; image: string }[],
    coverImage?: string,
  ) => {
    const resolved = await resolveAgentWorkCollectionItems({
      db,
      items,
      userId,
      shareVisitor: !!agentShareVisitor,
      topicId,
      workspaceId,
    });
    // The cover names one of the items the same way; map it to that item's
    // file. A cover outside the list stays as named and is refused as such.
    const coverRef = coverImage ? parseCollectionImageRef(coverImage) : undefined;
    const coverIndex = coverRef
      ? items.findIndex(({ image }) => parseCollectionImageRef(image) === coverRef)
      : -1;
    const coverFileId = coverIndex >= 0 ? resolved[coverIndex].fileId : coverRef;
    return { ...(coverFileId ? { coverFileId } : {}), items: resolved };
  };

  return {
    create: guarded(async (args) => {
      if (args.type === 'link') {
        const work = await workModel.createAgentWork(run, {
          description: args.description,
          title: args.title,
          type: 'link',
          url: args.url!,
        });
        return summarize(work);
      }
      const collection = await resolveCollection(args.items ?? [], args.coverImage);
      const work = await workModel.createAgentWork(run, {
        ...collection,
        description: args.description,
        title: args.title,
        type: 'collection',
      });
      return summarize(work, collection.items.length);
    }),
    delete: guarded(async (workId) => {
      const deleted = await workModel.deleteAgentWork(run, workId);
      return { title: deleted.title, workId: deleted.id };
    }),
    update: guarded(async (args) => {
      const collection = args.items
        ? await resolveCollection(args.items, args.coverImage)
        : undefined;
      const work = await workModel.updateAgentWork(run, {
        description: args.description,
        collection,
        title: args.title,
        workId: args.workId,
      });
      return summarize(work, collection?.items.length);
    }),
  };
};

/**
 * A run outside a conversation still gets the runtime: its calls return the
 * `unavailable` error instead of failing tool dispatch.
 */
const unavailableService = (error: WorkToolError): WorkToolService => {
  const refuse = async (): Promise<never> => {
    throw error;
  };
  return { create: refuse, delete: refuse, update: refuse };
};

export const workRuntime: ServerRuntimeRegistration = {
  identifier: WorkIdentifier,
  factory: (context) => {
    try {
      return new WorkExecutionRuntime(createWorkToolService(context));
    } catch (error) {
      if (error instanceof WorkToolError)
        return new WorkExecutionRuntime(unavailableService(error));
      throw error;
    }
  },
};
