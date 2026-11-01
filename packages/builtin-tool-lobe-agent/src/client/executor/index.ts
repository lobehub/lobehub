import { UserInteractionExecutionRuntime } from '@lobechat/builtin-tool-user-interaction/executionRuntime';
import type { BuiltinToolContext, BuiltinToolResult, ChatStreamPayload } from '@lobechat/types';
import { BaseExecutor, RequestTrigger } from '@lobechat/types';

import { notebookService } from '@/services/notebook';
import { useNotebookStore } from '@/store/notebook';

import { LobeAgentManifest } from '../../manifest';
import type { MediaFileItem } from '../../media';
import {
  buildAnalyzeMediaContent,
  createMediaFileItemsFromMessage,
  createUrlMediaFileItems,
  formatMediaUrlValidationError,
  getUnexpectedAnalyzeMediaArgumentKeys,
  hasAnalyzableMediaFiles,
  hasUserMediaFiles,
  normalizeAnalyzeMediaInput,
  selectMediaFileItems,
  validateMediaUrls,
} from '../../media';
import {
  type PlanDocument,
  PlanExecutionRuntime,
  type PlanRuntimeContext,
  type PlanRuntimeService,
} from '../../PlanRuntime';
import type {
  AnalyzeMediaParams,
  AskUserQuestionArgs,
  CallSubAgentParams,
  ClearTodosParams,
  CreatePlanParams,
  CreateTodosParams,
  UpdatePlanParams,
  UpdateTodosParams,
  VentParams,
  VentRejectionReason,
  VentState,
} from '../../types';
import { LobeAgentApiName } from '../../types';
import {
  createMemoryVentLedger,
  formatVentResultContent,
  getVentFingerprint,
  getVentScope,
  validateVentParams,
  type VentLedger,
} from '../../vent';
import { getTodosFromContext } from './planTodoHelper';
import { resolveClientMediaPayloadItems } from './resolveMediaUris';

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

  updatePlanMetadata: async (id, metadata, topicId) => {
    await notebookService.updateDocument({ id, metadata });
    const { invalidateDocumentMutation } = await import('@/services/document/invalidation');
    await invalidateDocumentMutation({ cause: 'notebook', documentId: id, topicId });
  },
};

const toPlanRuntimeContext = (ctx: BuiltinToolContext): PlanRuntimeContext => ({
  currentTodos: getTodosFromContext(ctx),
  messageId: ctx.messageId,
  signal: ctx.signal,
  topicId: ctx.topicId ?? undefined,
});

interface ParentMessage {
  parentId?: string;
}

const getMultimodalUnderstandingConfig = async () => {
  const { getServerConfigStoreState, serverConfigSelectors } = await import('@/store/serverConfig');
  const serverConfigState = getServerConfigStoreState();

  return serverConfigState
    ? serverConfigSelectors.multimodalUnderstanding(serverConfigState)
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

const isParentMessage = (message: unknown): message is ParentMessage =>
  !!message && typeof message === 'object';

const nestedSubAgentDisabledResult = (): BuiltinToolResult => ({
  content: 'Nested sub-agent execution is not allowed.',
  error: {
    message: 'Sub-agent calls cannot be triggered from within another sub-agent.',
    type: 'NestedSubAgentNotAllowed',
  },
  success: false,
});

class LobeAgentExecutor extends BaseExecutor<typeof LobeAgentApiName> {
  readonly identifier = LobeAgentManifest.identifier;
  protected readonly apiEnum = LobeAgentApiName;

  private planRuntime = new PlanExecutionRuntime(clientPlanService);

  // Reused from the standalone user-interaction tool — askUserQuestion is
  // human-intervention 'always', so in normal flows the user's UI submit
  // becomes the tool result and this runtime is only the fallback executor.
  private interactionRuntime = new UserInteractionExecutionRuntime();

  // A client run executes in this tab, so an in-memory ledger sees every vent
  // of the run.
  private ventLedger: VentLedger = createMemoryVentLedger();

  // ==================== Ask User Question ====================

  askUserQuestion = (params: AskUserQuestionArgs): Promise<BuiltinToolResult> =>
    this.interactionRuntime.askUserQuestion(params);

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

  // ==================== Vent ====================

  /**
   * Privately flag platform friction. The report's durable record is the
   * persisted tool-call message itself; this validates the input, admits at
   * most one distinct vent per run, and surfaces a settled state for the
   * inspector.
   */
  vent = async (params: VentParams, ctx: BuiltinToolContext): Promise<BuiltinToolResult> => {
    const invalid = validateVentParams(params);
    if (invalid === 'invalid_category' || invalid === 'invalid_severity') {
      const state: VentState = { recorded: false, reason: invalid };
      const message = formatVentResultContent(state);
      return {
        content: message,
        error: { message, type: 'InvalidArguments' },
        state,
        success: false,
      };
    }

    // `operationId` is the per-tool-call operation on the client; the run is
    // the root operation.
    const scope = getVentScope({
      operationId: ctx.rootOperationId ?? ctx.operationId,
      topicId: ctx.topicId,
    });
    let admission: VentRejectionReason | 'accepted' = invalid ?? 'accepted';
    if (!invalid && scope) {
      admission = await this.ventLedger.admit({
        fingerprint: getVentFingerprint(params),
        limit: scope.limit,
        scopeKey: scope.key,
      });
    }
    const recorded = admission === 'accepted';

    const state: VentState = {
      category: params.category,
      reason: admission === 'accepted' ? null : admission,
      recorded,
      severity: params.severity,
      ventId: recorded && ctx.toolCallId ? `vent:${ctx.toolCallId}` : null,
    };

    return { content: formatVentResultContent(state), state, success: true };
  };

  // ==================== Media Analysis ====================

  analyzeMedia = async (
    params: AnalyzeMediaParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    const config = await getMultimodalUnderstandingConfig();

    if (!config?.provider || !config.model) {
      return {
        error: {
          message: 'Multimodal understanding model is not configured',
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

    const { requestedRefs, requestedUrls } = normalizeAnalyzeMediaInput(
      params as unknown as Record<PropertyKey, unknown>,
    );
    if (requestedRefs.length === 0 && requestedUrls.length === 0) {
      const unexpectedKeys = getUnexpectedAnalyzeMediaArgumentKeys(
        params as unknown as Record<PropertyKey, unknown>,
      );
      const aliasHint =
        unexpectedKeys.length > 0 ? ` Do not use ${unexpectedKeys.join(', ')}.` : '';

      return {
        error: {
          message: `Either \`refs\` or \`urls\` is required and must include at least one media file ref or media URL.${aliasHint}`,
          type: 'InvalidToolArguments',
        },
        success: false,
      };
    }

    const urlValidation = validateMediaUrls(requestedUrls);
    const urlValidationError = formatMediaUrlValidationError(urlValidation);
    if (urlValidationError) {
      return {
        error: {
          message: urlValidationError,
          type: 'InvalidToolArguments',
        },
        success: false,
      };
    }

    const selectedUrls = createUrlMediaFileItems(urlValidation.validUrls);
    let selectedRefs: MediaFileItem[] = [];

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
        isParentMessage(toolMessage) &&
        toolMessage.parentId &&
        dbMessageSelectors.getDbMessageById(toolMessage.parentId)(chatState);
      const parentUserMessage =
        isParentMessage(assistantMessage) &&
        assistantMessage.parentId &&
        dbMessageSelectors.getDbMessageById(assistantMessage.parentId)(chatState);
      const sourceMessage = hasUserMediaFiles(sourceCandidate)
        ? sourceCandidate
        : hasUserMediaFiles(parentUserMessage)
          ? parentUserMessage
          : dbMessageSelectors.latestUserMessage(chatState);
      const activeMediaMessages = dbMessageSelectors
        .activeDbMessages(chatState)
        .filter(hasAnalyzableMediaFiles);
      const mediaMessages = [
        ...(hasAnalyzableMediaFiles(sourceMessage) ? [sourceMessage] : []),
        ...activeMediaMessages.filter((message) => message.id !== sourceMessage?.id),
      ];
      const files = mediaMessages.flatMap((message) => createMediaFileItemsFromMessage(message));

      if (files.length === 0) {
        return {
          error: {
            message: 'No media files are available in the current message',
            type: 'MediaFilesNotFound',
          },
          success: false,
        };
      }

      const selectableFiles = files;
      const { invalidRefs, selected } = selectMediaFileItems(selectableFiles, requestedRefs);

      if (invalidRefs?.length) {
        const availableRefs = selectableFiles.map((file) => file.ref);

        return {
          content: `Unknown file refs: ${invalidRefs.join(', ')}. Available refs: ${availableRefs.join(', ')}`,
          error: { message: 'Unknown media file refs', type: 'InvalidToolArguments' },
          state: { availableFiles: selectableFiles, invalidRefs },
          success: false,
        };
      }

      selectedRefs = selected;
    }

    const selectedItems = [...selectedRefs, ...selectedUrls];

    if (selectedItems.length === 0) {
      return {
        error: { message: 'No media files selected', type: 'InvalidToolArguments' },
        success: false,
      };
    }

    const payloadItems = await resolveClientMediaPayloadItems({ selectedRefs, selectedUrls });

    let content = '';
    let error: { message?: string } | undefined;
    let usage: unknown;
    const abortController = createAbortController(ctx.signal);
    const { chatService } = await import('@/services/chat');

    const payload = {
      max_tokens: 2000,
      messages: [
        {
          content: buildAnalyzeMediaContent(payloadItems, params.question, {
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
      metadata: { trigger: RequestTrigger.MultimodalAnalysis },
      signal: abortController.signal,
    });

    if (abortController.signal.aborted) {
      return { stop: true, success: false };
    }

    if (error) {
      return {
        error: {
          body: error,
          message: error.message ?? 'Multimodal understanding request failed',
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
        trigger: RequestTrigger.MultimodalAnalysis,
        usage,
      },
      success: true,
    };
  };

  // ==================== Sub-Agent ====================
  //
  // Sub-agents run on the server: the agent loop, and with it `callSubAgent`,
  // is server-side (`serverRuntimes`). The browser has no runtime to start
  // one in, so a browser invocation says so instead of pretending.

  callSubAgent = async (
    _params: CallSubAgentParams,
    ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (ctx.isSubAgent) {
      return nestedSubAgentDisabledResult();
    }

    return { content: 'Sub-agent execution is not available in this runtime.', success: false };
  };
}

export const lobeAgentExecutor = new LobeAgentExecutor();
