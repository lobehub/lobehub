import type { BuiltinToolContext, BuiltinToolResult, ChatStreamPayload } from '@lobechat/types';
import { BaseExecutor, RequestTrigger } from '@lobechat/types';

import { notebookService } from '@/services/notebook';
import { useNotebookStore } from '@/store/notebook';

import { LobeAgentManifest } from '../../manifest';
import type {
  AnalyzeVisualMediaParams,
  CallSubAgentParams,
  CallSubAgentsParams,
  ClearTodosParams,
  CreatePlanParams,
  CreateTodosParams,
  UpdatePlanParams,
  UpdateTodosParams,
} from '../../types';
import { LobeAgentApiName } from '../../types';
import type { VisualFileItem } from '../../visualMedia';
import {
  buildAnalyzeVisualMediaContent,
  createUrlVisualFileItems,
  createVisualFileItems,
  formatVisualMediaUrlValidationError,
  getUnexpectedAnalyzeVisualMediaArgumentKeys,
  hasUserVisualFiles,
  normalizeAnalyzeVisualMediaInput,
  selectVisualFileItems,
  validateVisualMediaUrls,
} from '../../visualMedia';
import {
  type PlanDocument,
  PlanExecutionRuntime,
  type PlanRuntimeContext,
  type PlanRuntimeService,
} from './PlanRuntime';
import { getTodosFromContext } from './planTodoHelper';

const PLAN_DOC_TYPE = 'agent/plan';

/**
 * Normalize a document payload returned by notebookService / useNotebookStore
 * into the `PlanDocument` shape expected by PlanExecutionRuntime.
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
 * Client-side implementation of the Plan runtime service.
 * Routes user-facing plan CRUD through useNotebookStore (so SWR caches refresh),
 * and keeps silent metadata writes (todos sync) on the raw notebookService.
 */
const clientPlanService: PlanRuntimeService = {
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

const toPlanRuntimeContext = (ctx: BuiltinToolContext): PlanRuntimeContext => ({
  currentTodos: getTodosFromContext(ctx),
  messageId: ctx.messageId,
  signal: ctx.signal,
  topicId: ctx.topicId ?? undefined,
});

interface VisualSourceMessage {
  parentId?: string;
}

const getVisualUnderstandingConfig = async () => {
  const { getServerConfigStoreState, serverConfigSelectors } = await import('@/store/serverConfig');
  const serverConfigState = getServerConfigStoreState();

  return serverConfigState
    ? serverConfigSelectors.visualUnderstanding(serverConfigState)
    : undefined;
};

const createAbortController = (signal?: AbortSignal) => {
  const abortController = new AbortController();

  if (signal?.aborted) {
    abortController.abort();
    return abortController;
  }

  signal?.addEventListener('abort', () => abortController.abort(), { once: true });

  return abortController;
};

const isVisualSourceMessage = (message: unknown): message is VisualSourceMessage =>
  !!message && typeof message === 'object';

class LobeAgentExecutor extends BaseExecutor<typeof LobeAgentApiName> {
  readonly identifier = LobeAgentManifest.identifier;
  protected readonly apiEnum = LobeAgentApiName;

  private planRuntime = new PlanExecutionRuntime(clientPlanService);

  // ==================== Plan / Todo ====================

  createPlan = (params: CreatePlanParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.createPlan(params, toPlanRuntimeContext(ctx));

  updatePlan = (params: UpdatePlanParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.updatePlan(params, toPlanRuntimeContext(ctx));

  createTodos = (params: CreateTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.createTodos(params, toPlanRuntimeContext(ctx));

  updateTodos = (params: UpdateTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.updateTodos(params, toPlanRuntimeContext(ctx));

  clearTodos = (params: ClearTodosParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> =>
    this.planRuntime.clearTodos(params, toPlanRuntimeContext(ctx));

  // ==================== Visual ====================

  analyzeVisualMedia = async (
    params: AnalyzeVisualMediaParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const config = await getVisualUnderstandingConfig();

    if (!config?.provider || !config.model) {
      return {
        error: {
          message: 'Visual understanding model is not configured',
          type: 'PluginSettingsInvalid',
        },
        success: false,
      };
    }

    if (!params.question?.trim()) {
      return {
        error: { message: '`question` is required', type: 'InvalidToolArguments' },
        success: false,
      };
    }

    const { requestedRefs, requestedUrls } = normalizeAnalyzeVisualMediaInput(
      params as unknown as Record<PropertyKey, unknown>,
    );
    if (requestedRefs.length === 0 && requestedUrls.length === 0) {
      const unexpectedKeys = getUnexpectedAnalyzeVisualMediaArgumentKeys(
        params as unknown as Record<PropertyKey, unknown>,
      );
      const aliasHint =
        unexpectedKeys.length > 0 ? ` Do not use ${unexpectedKeys.join(', ')}.` : '';

      return {
        error: {
          message: `Either \`refs\` or \`urls\` is required and must include at least one visual file ref or media URL.${aliasHint}`,
          type: 'InvalidToolArguments',
        },
        success: false,
      };
    }

    const urlValidation = validateVisualMediaUrls(requestedUrls);
    const urlValidationError = formatVisualMediaUrlValidationError(urlValidation);
    if (urlValidationError) {
      return {
        error: {
          message: urlValidationError,
          type: 'InvalidToolArguments',
        },
        success: false,
      };
    }

    const selectedUrls = createUrlVisualFileItems(urlValidation.validUrls);
    let selectedRefs: VisualFileItem[] = [];

    if (requestedRefs.length > 0) {
      const [{ getChatStoreState }, { dbMessageSelectors }] = await Promise.all([
        import('@/store/chat'),
        import('@/store/chat/selectors'),
      ]);

      const chatState = getChatStoreState();
      const sourceCandidate =
        ctx.sourceMessageId && dbMessageSelectors.getDbMessageById(ctx.sourceMessageId)(chatState);
      const toolMessage = dbMessageSelectors.getDbMessageById(ctx.messageId)(chatState);
      const assistantMessage =
        isVisualSourceMessage(toolMessage) &&
        toolMessage.parentId &&
        dbMessageSelectors.getDbMessageById(toolMessage.parentId)(chatState);
      const parentUserMessage =
        isVisualSourceMessage(assistantMessage) &&
        assistantMessage.parentId &&
        dbMessageSelectors.getDbMessageById(assistantMessage.parentId)(chatState);
      const sourceMessage = hasUserVisualFiles(sourceCandidate)
        ? sourceCandidate
        : hasUserVisualFiles(parentUserMessage)
          ? parentUserMessage
          : dbMessageSelectors.latestUserMessage(chatState);
      const activeVisualMessages = dbMessageSelectors
        .activeDbMessages(chatState)
        .filter(hasUserVisualFiles);
      const visualMessages = [
        ...(hasUserVisualFiles(sourceMessage) ? [sourceMessage] : []),
        ...activeVisualMessages.filter((message) => message.id !== sourceMessage?.id),
      ];
      const files = visualMessages.flatMap((message) =>
        createVisualFileItems(message, message.imageList, message.videoList),
      );

      if (files.length === 0) {
        return {
          error: {
            message: 'No visual files are available in the current message',
            type: 'VisualFilesNotFound',
          },
          success: false,
        };
      }

      const selectableFiles = files;
      const { invalidRefs, selected } = selectVisualFileItems(selectableFiles, requestedRefs);

      if (invalidRefs?.length) {
        const availableRefs = selectableFiles.map((file) => file.ref);

        return {
          content: `Unknown file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}`,
          error: { message: 'Unknown visual file refs', type: 'InvalidToolArguments' },
          state: { availableFiles: selectableFiles, invalidRefs },
          success: false,
        };
      }

      selectedRefs = selected;
    }

    const selectedItems = [...selectedRefs, ...selectedUrls];

    if (selectedItems.length === 0) {
      return {
        error: { message: 'No visual files selected', type: 'InvalidToolArguments' },
        success: false,
      };
    }

    let content = '';
    let error: { message?: string } | undefined;
    let usage: unknown;
    const abortController = createAbortController(ctx.signal);
    const { chatService } = await import('@/services/chat');

    const payload = {
      max_tokens: 2000,
      messages: [
        {
          content: buildAnalyzeVisualMediaContent(selectedItems, params.question, {
            includeFallbackInstruction: true,
            includeFileSummary: true,
          }),
          role: 'user' as const,
        },
      ],
      model: config.model,
      provider: config.provider,
      stream: true,
    } satisfies Partial<ChatStreamPayload>;

    await chatService.getChatCompletion(payload, {
      onFinish: async (output, metadata) => {
        content = output || content;
        usage = metadata.usage;
      },
      onErrorHandle: (err) => {
        error = err;
      },
      onMessageHandle: (chunk) => {
        if (chunk.type === 'text') content += chunk.text || '';
      },
      metadata: { trigger: RequestTrigger.VisualAnalysis },
      signal: abortController.signal,
    });

    if (abortController.signal.aborted) {
      return { stop: true, success: false };
    }

    if (error) {
      return {
        error: {
          body: error,
          message: error.message ?? 'Visual understanding request failed',
          type: 'PluginServerError',
        },
        success: false,
      };
    }

    return {
      content,
      state: {
        files: selectedItems,
        model: config.model,
        provider: config.provider,
        trigger: RequestTrigger.VisualAnalysis,
        usage,
      },
      success: true,
    };
  };

  // ==================== Sub-Agent ====================
  //
  // The executor only constructs the state payload that bridges the tool call
  // to the agent-runtime instruction layer. The actual sub-agent dispatch is
  // handled by `createAgentExecutors.ts` which reads `state.type` to emit the
  // matching `exec_sub_agent` / `exec_client_sub_agent(s)` instruction.

  callSubAgent = async (
    params: CallSubAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { description, instruction, inheritMessages, timeout, runInClient } = params;

    if (!description || !instruction) {
      return { content: 'Sub-agent description and instruction are required.', success: false };
    }

    const task = { description, inheritMessages, instruction, runInClient, timeout };
    const stateType = runInClient ? 'execClientSubAgent' : 'execSubAgent';

    return {
      content: `🚀 Dispatched sub-agent for ${runInClient ? 'client-side' : ''} execution:\n- ${description}`,
      state: { parentMessageId: ctx.messageId ?? '', task, type: stateType },
      stop: true,
      success: true,
    };
  };

  callSubAgents = async (
    params: CallSubAgentsParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const { tasks } = params;

    if (!tasks || tasks.length === 0) {
      return { content: 'No sub-agents provided to dispatch.', success: false };
    }

    const taskCount = tasks.length;
    const taskList = tasks.map((t, i) => `${i + 1}. ${t.description}`).join('\n');
    const hasClientTasks = tasks.some((t) => t.runInClient);
    const stateType = hasClientTasks ? 'execClientSubAgents' : 'execSubAgents';
    const executionMode = hasClientTasks ? 'client-side' : '';

    return {
      content: `🚀 Dispatched ${taskCount} sub-agent${taskCount > 1 ? 's' : ''} for ${executionMode} execution:\n${taskList}`,
      state: { parentMessageId: ctx.messageId ?? '', tasks, type: stateType },
      stop: true,
      success: true,
    };
  };
}

export const lobeAgentExecutor = new LobeAgentExecutor();
