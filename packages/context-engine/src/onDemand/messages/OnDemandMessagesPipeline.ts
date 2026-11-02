import type {
  OnDemandAppendedMessage,
  OnDemandBootstrapToolMetadata,
  OnDemandBudgetDecision,
  OnDemandBudgetMetadata,
  OnDemandContextMetadata,
  OnDemandDynamicEntryMetadata,
  OnDemandMessageSegmentMetadata,
  OnDemandRetrievalMetadata,
  OnDemandTokenMetadata,
  OpenAIChatMessage,
} from '@lobechat/types';
import {
  compareOnDemandDynamicEntries,
  ON_DEMAND_BOOTSTRAP_IDENTIFIERS,
  ON_DEMAND_PROTOCOL_VERSION,
} from '@lobechat/types';

import type { MessagesEngineParams, MessagesEngineResult } from '../../engine/messages/types';
import { GroupMessageFlattenProcessor } from '../../processors/GroupMessageFlatten';
import { ToolCallProcessor } from '../../processors/ToolCall';
import type { ContextBuckets, PipelineContextMetadata } from '../../types';
import { buildOnDemandBootstrapToolSet } from '../bootstrapTooling';
import { resolveOnDemandBudgetConfig } from '../budgetConfig';
import {
  createOnDemandTokenEstimator,
  estimateOnDemandTokensWithFallback,
  ON_DEMAND_TOKEN_ESTIMATOR_ID,
} from '../budgetPlanner';
import { hashContent } from '../canonical';
import {
  buildOnDemandProtocol,
  buildOnDemandStablePrefix,
  ON_DEMAND_PROTOCOL_CONTENT,
} from '../protocolBuilder';
import { retrieveOnDemandContext } from '../retrieval/ranking';
import { buildOnDemandCandidatesFromUserMemory } from '../retrieval/userMemory';
import {
  collectOnDemandDynamicCandidates,
  ON_DEMAND_FIRST_TURN_RELEVANCE,
  type OnDemandDynamicCandidate,
} from './dynamicCandidates';

export interface OnDemandMessagesOptions {
  genToolCallingName?: (identifier: string, apiName: string, type?: string) => string;
}

const messageText = (content: unknown): string =>
  typeof content === 'string' ? content : JSON.stringify(content ?? '');

const concatenateMessageText = (messages: readonly { content?: unknown }[]): string =>
  messages.map((message) => messageText(message.content)).join('');

const buildContextBuckets = (messages: readonly OpenAIChatMessage[]): ContextBuckets => ({
  chats: messages
    .slice(1)
    .map((message) => messageText(message.content))
    .join(''),
  historySummary: '',
  systemRole: messageText(messages[0]?.content),
  tools: '',
});

const buildMessageSegments = ({
  appendedMessages,
  currentUserSourceIndex,
  estimate,
  messages,
  sourceMessageCount,
}: {
  appendedMessages: readonly OnDemandAppendedMessage[];
  currentUserSourceIndex: number;
  estimate: (content: string) => number;
  messages: readonly OpenAIChatMessage[];
  sourceMessageCount: number;
}): OnDemandMessageSegmentMetadata[] => {
  const segments: OnDemandMessageSegmentMetadata[] = [];
  const system = messages[0];
  const systemContent = messageText(system?.content);

  segments.push({
    contentHash: hashContent(systemContent),
    estimatedTokens: estimate(systemContent),
    index: 0,
    role: system?.role ?? 'system',
    source: 'stable_system',
  });

  for (let sourceIndex = 0; sourceIndex < sourceMessageCount; sourceIndex += 1) {
    const message = messages[sourceIndex + 1];
    const content = messageText(message?.content);
    const source = sourceIndex === currentUserSourceIndex ? 'current_user' : 'history';

    segments.push({
      contentHash: hashContent(message?.content),
      estimatedTokens: estimate(content),
      index: sourceIndex + 1,
      role: message?.role ?? 'user',
      source,
    });
  }

  appendedMessages.forEach((appendedMessage, offset) => {
    const index = sourceMessageCount + 1 + offset;
    const message = messages[index];
    const content = messageText(message?.content);
    const metadata = appendedMessage.metadata;

    segments.push({
      contentHash: hashContent(message?.content),
      estimatedTokens: estimate(content),
      entryKey: metadata.entryKey,
      index,
      kind: metadata.kind,
      role: message?.role ?? 'user',
      source: 'dynamic_suffix',
      sourceId: metadata.source.id,
      sourceType: metadata.source.type,
    });
  });

  return segments;
};

/**
 * Convert UI rows to the wire shape without changing any text. Only protocol
 * fields already present on the row are forwarded; timestamps and renderer
 * metadata are intentionally not sent to the model.
 */
const toOpenAIMessage = (message: MessagesEngineParams['messages'][number]): OpenAIChatMessage => {
  const source = message as unknown as Record<string, unknown>;
  const role = source.role;
  if (role !== 'assistant' && role !== 'system' && role !== 'tool' && role !== 'user') {
    throw new Error(`On-demand context does not support message role: ${String(role)}`);
  }

  return {
    content: source.content as OpenAIChatMessage['content'],
    role,
    ...(source.name !== undefined && { name: source.name as string }),
    ...(source.tool_call_id !== undefined && {
      tool_call_id: source.tool_call_id as string,
    }),
    ...(source.tool_calls !== undefined && {
      tool_calls: source.tool_calls as OpenAIChatMessage['tool_calls'],
    }),
  };
};

const findCurrentUserMessage = (
  messages: MessagesEngineParams['messages'],
): { index: number; message: MessagesEngineParams['messages'][number] } | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user') return { index, message };
  }
};

const estimateActiveToolContracts = (
  params: MessagesEngineParams,
  estimator: ReturnType<typeof createOnDemandTokenEstimator>,
): number => {
  const enabledIds = new Set(params.toolsConfig?.tools ?? []);
  const bootstrapIds = new Set<string>(ON_DEMAND_BOOTSTRAP_IDENTIFIERS);

  return (params.toolsConfig?.manifests ?? [])
    .filter(
      (manifest) => enabledIds.has(manifest.identifier) && !bootstrapIds.has(manifest.identifier),
    )
    .reduce(
      (sum, manifest) =>
        sum + estimateOnDemandTokensWithFallback(JSON.stringify(manifest), estimator).tokens,
      0,
    );
};

const buildDynamicEntryMetadata = (
  candidates: readonly OnDemandDynamicCandidate[],
  budget: OnDemandBudgetMetadata,
): OnDemandDynamicEntryMetadata[] => {
  const decisionsByKey = new Map(budget.decisions.map((decision) => [decision.key, decision]));
  const degradationsByKey = new Map(
    budget.degraded.map((degradation) => [degradation.key, degradation]),
  );

  return [...candidates]
    .sort((a, b) => compareOnDemandDynamicEntries(a.entry, b.entry))
    .map(({ entry, firstTurnEligible }) => {
      const decision = decisionsByKey.get(entry.key);
      const degradation = degradationsByKey.get(entry.key);
      const status = firstTurnEligible ? (decision?.status ?? 'omitted') : 'omitted';
      const dropReason =
        status === 'omitted'
          ? !firstTurnEligible
            ? 'first_turn_body_deferred'
            : (decision?.reason ?? 'low_relevance')
          : undefined;
      const degradeReason = degradation?.reason ?? dropReason;

      return {
        decision: status,
        ...(degradation && { degradation }),
        ...(degradeReason && { degradeReason }),
        ...(dropReason && { dropReason }),
        estimatedTokens: decision?.estimatedTokens ?? entry.estimatedTokens,
        included: status !== 'omitted',
        key: entry.key,
        kind: entry.kind,
        ...(decision?.originalEstimatedTokens !== undefined && {
          originalEstimatedTokens: decision.originalEstimatedTokens,
        }),
        priority: entry.priority,
        provenance: entry.provenance,
        relevance: entry.relevance,
        required: entry.required,
        source: entry.source,
      };
    });
};

const toBudgetMetadata = (budget: OnDemandBudgetDecision): OnDemandBudgetMetadata => ({
  availableDynamicTokens: budget.availableDynamicTokens,
  decisions: budget.decisions.map((decision) => ({ ...decision })),
  degraded: budget.degraded.map(({ degradedEntry, entry, reason }) => ({
    estimatedTokens: degradedEntry.estimatedTokens,
    key: entry.key,
    originalContentHash: entry.provenance.contentHash,
    originalEstimatedTokens: entry.estimatedTokens,
    reason,
    recoveryRef: degradedEntry.degradedFrom?.recoveryRef ?? degradedEntry.key,
  })),
  dropped: budget.dropped.map(({ entry, reason }) => ({
    key: entry.key,
    reason,
  })),
  estimator: { ...budget.estimator },
  estimatorFailureCount: budget.estimatorFailureCount,
  fixedBreakdown: { ...budget.fixedBreakdown },
  fixedTokens: budget.fixedTokens,
  hardFloorOverflowTokens: budget.hardFloorOverflowTokens,
  hardFloorTokens: budget.hardFloorTokens,
  hash: budget.hash,
  maxDynamicTokens: budget.maxDynamicTokens,
  maxTokens: budget.maxTokens,
  reserveTokens: budget.reserveTokens,
  reserveUsedTokens: budget.reserveUsedTokens,
  selectedKeys: budget.selected.map((entry) => entry.key),
  selectedOptionalTokens: budget.selectedOptionalTokens,
  status: budget.status,
  totalTokens: budget.totalTokens,
});

const buildOnDemandMetadata = ({
  bootstrapTools,
  bootstrapToolCount,
  budget,
  currentUserHash,
  dynamicEntries,
  messageSegments,
  rawSystemRole,
  retrieval,
  stablePrefixHash,
  tokens,
}: {
  bootstrapTools: readonly OnDemandBootstrapToolMetadata[];
  bootstrapToolCount: number;
  budget: OnDemandBudgetMetadata;
  currentUserHash: string;
  dynamicEntries: readonly OnDemandDynamicEntryMetadata[];
  messageSegments: readonly OnDemandMessageSegmentMetadata[];
  rawSystemRole: string;
  retrieval?: OnDemandRetrievalMetadata;
  stablePrefixHash: string;
  tokens: OnDemandTokenMetadata;
}): OnDemandContextMetadata => ({
  bootstrapTools,
  bootstrapToolIds: ON_DEMAND_BOOTSTRAP_IDENTIFIERS.slice(0, bootstrapToolCount),
  budget,
  contextMode: 'on-demand',
  currentUserMessageHash: currentUserHash,
  dynamicEntries,
  messageSegments,
  protocolVersion: ON_DEMAND_PROTOCOL_VERSION,
  rawSystemRoleHash: hashContent(rawSystemRole),
  ...(retrieval && { retrieval }),
  stablePrefixHash,
  tokens,
});

/**
 * Third-mode assembly. It deliberately does not reuse any legacy injector:
 * the stable system message is only the raw Agent Prompt plus the fixed
 * protocol, and all mutable context is appended after the current user turn.
 */
export class OnDemandMessagesPipeline {
  constructor(
    private readonly params: MessagesEngineParams,
    private readonly options: OnDemandMessagesOptions = {},
  ) {}

  async process(): Promise<MessagesEngineResult> {
    const startTime = Date.now();
    const flattenedMessages = await new GroupMessageFlattenProcessor().process({
      initialState: { messages: [] },
      isAborted: false,
      messages: this.params.messages as any[],
      metadata: {},
    });
    const preparedMessages = await new ToolCallProcessor({
      genToolCallingName: this.options.genToolCallingName,
      isCanUseFC: this.params.capabilities?.isCanUseFC,
      model: this.params.model,
      provider: this.params.provider,
    }).process(flattenedMessages);
    const sourceMessages = preparedMessages.messages as MessagesEngineParams['messages'];
    const rawSystemRole = this.params.systemRole ?? '';
    const stablePrefix = buildOnDemandStablePrefix({ agentPrompt: rawSystemRole });
    const bootstrapToolSet = buildOnDemandBootstrapToolSet();
    const systemContent = rawSystemRole
      ? `${rawSystemRole}\n\n${ON_DEMAND_PROTOCOL_CONTENT}`
      : ON_DEMAND_PROTOCOL_CONTENT;
    const currentUserMatch = findCurrentUserMessage(sourceMessages);

    if (!currentUserMatch) {
      throw new Error('On-demand context requires a current user message.');
    }
    const currentUserMessage = currentUserMatch.message;

    const estimatorInfo = {
      id: ON_DEMAND_TOKEN_ESTIMATOR_ID,
      model: this.params.model,
      provider: this.params.provider,
    } as const;
    const estimator = createOnDemandTokenEstimator(estimatorInfo);
    const estimate = (content: string) =>
      estimateOnDemandTokensWithFallback(content, estimator).tokens;
    const budgetConfig = resolveOnDemandBudgetConfig(
      this.params.onDemand?.budget,
      this.params.onDemand?.maxTokens,
    );
    const activeToolContracts = estimateActiveToolContracts(this.params, estimator);

    const suppliedRetrieval = this.params.onDemand?.retrieval;
    const retrieval = retrieveOnDemandContext({
      batch: {
        candidates: suppliedRetrieval
          ? suppliedRetrieval.candidates
          : buildOnDemandCandidatesFromUserMemory(
              this.params.userMemory?.memories,
              currentUserMessage.content,
            ),
        durationMs: suppliedRetrieval?.durationMs,
        mode: suppliedRetrieval?.mode,
      },
      currentUserMessage: currentUserMessage.content,
    });
    const dynamicCandidates = [
      ...collectOnDemandDynamicCandidates(this.params, currentUserMessage.content),
      ...retrieval.entries.map<OnDemandDynamicCandidate>((entry) => ({
        entry,
        firstTurnEligible: true,
      })),
    ];
    const retrievalEntryKeys = new Set(retrieval.entries.map((entry) => entry.key));
    const firstTurnEntries = dynamicCandidates
      .filter(
        (candidate) =>
          candidate.firstTurnEligible &&
          (candidate.entry.required ||
            retrievalEntryKeys.has(candidate.entry.key) ||
            candidate.entry.relevance >= ON_DEMAND_FIRST_TURN_RELEVANCE),
      )
      .map((candidate) => candidate.entry);

    const protocol = buildOnDemandProtocol({
      budget: {
        estimator,
        estimatorInfo,
        fixedTokens: {
          activeToolContracts,
          bootstrapTools: estimate(JSON.stringify(bootstrapToolSet.tools)),
          currentUserMessage: estimate(currentUserMessage.content),
          protocol: estimate(ON_DEMAND_PROTOCOL_CONTENT),
          userPrompt: estimate(rawSystemRole),
        },
        maxDynamicTokens: budgetConfig.dynamicTokens,
        maxTokens: budgetConfig.totalTokens,
        reserveTokens: budgetConfig.reserveTokens,
      },
      currentUserMessage: {
        content: currentUserMessage.content,
        ...(currentUserMessage.id && { id: currentUserMessage.id }),
        role: 'user',
      },
      entries: firstTurnEntries,
      stablePrefix,
    });

    const conversationMessages = sourceMessages.map(toOpenAIMessage);
    const messages: OpenAIChatMessage[] = [
      { content: systemContent, role: 'system' },
      ...conversationMessages,
      ...(protocol.appendedMessages as readonly OpenAIChatMessage[]),
    ];
    const budgetMetadata = toBudgetMetadata(protocol.budget);
    const dynamicEntries = buildDynamicEntryMetadata(dynamicCandidates, budgetMetadata);
    const messageSegments = buildMessageSegments({
      appendedMessages: protocol.appendedMessages,
      currentUserSourceIndex: currentUserMatch.index,
      estimate,
      messages,
      sourceMessageCount: sourceMessages.length,
    });
    const bootstrapTools: OnDemandBootstrapToolMetadata[] = bootstrapToolSet.enabledToolIds.map(
      (identifier) => {
        const manifest = bootstrapToolSet.manifestMap[identifier];
        return {
          apiNames: manifest.api.map((api) => api.name),
          identifier: identifier as OnDemandBootstrapToolMetadata['identifier'],
          manifestHash: hashContent(manifest),
        };
      },
    );
    const messageTotal = messageSegments.reduce(
      (total, segment) => total + segment.estimatedTokens,
      0,
    );
    const tokens: OnDemandTokenMetadata = {
      bootstrapTools: budgetMetadata.fixedBreakdown.bootstrapTools,
      budgetTotal: budgetMetadata.totalTokens,
      dynamic: budgetMetadata.totalTokens - budgetMetadata.fixedTokens,
      fixed: budgetMetadata.fixedTokens,
      max: budgetMetadata.maxTokens,
      messageTotal,
      reserve: budgetMetadata.reserveTokens,
      reserveUsed: budgetMetadata.reserveUsedTokens,
      stableSystem: messageSegments[0]?.estimatedTokens ?? 0,
    };
    const includedRetrievalCount = dynamicEntries.filter(
      (entry) => retrievalEntryKeys.has(entry.key) && entry.included,
    ).length;
    const degradedRetrievalCount = dynamicEntries.filter(
      (entry) =>
        retrievalEntryKeys.has(entry.key) && (entry.decision === 'degraded' || !entry.included),
    ).length;
    const onDemandContext = buildOnDemandMetadata({
      bootstrapTools,
      bootstrapToolCount: bootstrapToolSet.enabledToolIds.length,
      budget: budgetMetadata,
      currentUserHash: protocol.currentUserMessageHash,
      dynamicEntries,
      messageSegments,
      rawSystemRole,
      retrieval: {
        ...retrieval.metadata,
        degradedCount: degradedRetrievalCount,
        includedCount: includedRetrievalCount,
      },
      stablePrefixHash: stablePrefix.hash,
      tokens,
    });
    const metadata: PipelineContextMetadata = {
      bootstrapToolIds: onDemandContext.bootstrapToolIds,
      contextBuckets: buildContextBuckets(messages),
      contextChatsBase: concatenateMessageText(conversationMessages),
      contextMode: 'on-demand',
      dynamicEntries,
      onDemandContext,
      protocolVersion: onDemandContext.protocolVersion,
      rawSystemRoleHash: onDemandContext.rawSystemRoleHash,
      stablePrefixHash: onDemandContext.stablePrefixHash,
    } as PipelineContextMetadata;

    return {
      messages,
      metadata,
      stats: {
        processedCount: 3,
        processorDurations: {
          OnDemandDynamicCandidates: 0,
          OnDemandStablePrefix: 0,
          OnDemandSuffix: 0,
        },
        totalDuration: Date.now() - startTime,
      },
    };
  }
}

export const processOnDemandMessages = async (
  params: MessagesEngineParams,
  options?: OnDemandMessagesOptions,
): Promise<MessagesEngineResult> => new OnDemandMessagesPipeline(params, options).process();
