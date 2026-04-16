import type { BuiltinToolContext, BuiltinToolResult } from '@lobechat/types';
import { BaseExecutor } from '@lobechat/types';

import { notebookService } from '@/services/notebook';
import { useNotebookStore } from '@/store/notebook';

import {
  GTDExecutionRuntime,
  type GTDRuntimeContext,
  type GTDRuntimeService,
  type PlanDocument,
} from '../ExecutionRuntime';
import { GTDIdentifier } from '../manifest';
import type {
  ClearTodosParams,
  CreatePlanParams,
  CreateTodosParams,
  ExecTaskParams,
  ExecTasksParams,
  UpdatePlanParams,
  UpdateTodosParams,
} from '../types';
import { GTDApiName } from '../types';
import { getTodosFromContext } from './helper';

const PLAN_DOC_TYPE = 'agent/plan';

/**
 * Normalize a document payload returned by notebookService / useNotebookStore
 * into the `PlanDocument` shape expected by GTDExecutionRuntime.
 */
const normalizePlanDoc = (doc: {
  content?: string | null;
  createdAt: Date | string;
  description?: string | null;
  id: string;
  metadata?: Record<string, any> | null;
  title?: string | null;
  updatedAt: Date | string;
}): PlanDocument => ({
  content: doc.content ?? null,
  createdAt: typeof doc.createdAt === 'string' ? new Date(doc.createdAt) : doc.createdAt,
  description: doc.description ?? null,
  id: doc.id,
  metadata: doc.metadata ?? null,
  title: doc.title ?? null,
  updatedAt: typeof doc.updatedAt === 'string' ? new Date(doc.updatedAt) : doc.updatedAt,
});

/**
 * Client-side implementation of the GTD runtime service.
 * Routes user-facing plan CRUD through useNotebookStore (so SWR caches refresh),
 * and keeps silent metadata writes (todos sync) on the raw notebookService.
 */
const clientGTDService: GTDRuntimeService = {
  createPlan: async ({ topicId, goal, description, content }) => {
    const doc = await useNotebookStore.getState().createDocument({
      content,
      description,
      title: goal,
      topicId,
      type: PLAN_DOC_TYPE,
    });
    return normalizePlanDoc(doc);
  },

  findPlanById: async (id) => {
    const doc = await notebookService.getDocument(id);
    return doc ? normalizePlanDoc(doc) : null;
  },

  findPlanByTopic: async (topicId) => {
    const result = await notebookService.listDocuments({ topicId, type: PLAN_DOC_TYPE });
    const first = result.data[0];
    return first ? normalizePlanDoc(first) : null;
  },

  updatePlan: async (id, { goal, description, content }, topicId) => {
    const doc = await useNotebookStore
      .getState()
      .updateDocument({ content, description, id, title: goal }, topicId ?? '');
    if (!doc) throw new Error(`Plan not found after update: ${id}`);
    return normalizePlanDoc(doc);
  },

  updatePlanMetadata: async (id, metadata) => {
    await notebookService.updateDocument({ id, metadata });
  },
};

const GTDApiNameEnum = {
  clearTodos: GTDApiName.clearTodos,
  createPlan: GTDApiName.createPlan,
  createTodos: GTDApiName.createTodos,
  execTask: GTDApiName.execTask,
  execTasks: GTDApiName.execTasks,
  updatePlan: GTDApiName.updatePlan,
  updateTodos: GTDApiName.updateTodos,
} as const;

const toRuntimeContext = (ctx: BuiltinToolContext): GTDRuntimeContext => ({
  currentTodos: getTodosFromContext(ctx),
  messageId: ctx.messageId,
  signal: ctx.signal,
  topicId: ctx.topicId ?? undefined,
});

class GTDExecutor extends BaseExecutor<typeof GTDApiNameEnum> {
  readonly identifier = GTDIdentifier;
  protected readonly apiEnum = GTDApiNameEnum;

  private runtime = new GTDExecutionRuntime(clientGTDService);

  createTodos = (params: CreateTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.createTodos(params, toRuntimeContext(ctx));

  updateTodos = (params: UpdateTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.updateTodos(params, toRuntimeContext(ctx));

  clearTodos = (params: ClearTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.clearTodos(params, toRuntimeContext(ctx));

  createPlan = (params: CreatePlanParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.createPlan(params, toRuntimeContext(ctx));

  updatePlan = (params: UpdatePlanParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.updatePlan(params, toRuntimeContext(ctx));

  execTask = (params: ExecTaskParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.execTask(params, toRuntimeContext(ctx));

  execTasks = (params: ExecTasksParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.runtime.execTasks(params, toRuntimeContext(ctx));
}

export const gtdExecutor = new GTDExecutor();
