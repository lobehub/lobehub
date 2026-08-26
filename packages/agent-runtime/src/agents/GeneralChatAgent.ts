import { ToolNameResolver } from '@lobechat/context-engine';
import {
  type ChatToolPayload,
  type ExtendedHumanInterventionConfig,
  type HumanInterventionConfig,
  type HumanInterventionPolicy,
} from '@lobechat/types';

import { createDefaultGlobalAudits, DEFAULT_SECURITY_BLACKLIST } from '../audit';
import { InterventionChecker } from '../core';
import {
  type Agent,
  type AgentInstruction,
  type AgentInstructionCompressContext,
  type AgentRuntimeContext,
  type AgentState,
  type GeneralAgentCallingToolInstructionPayload,
  type GeneralAgentCallLLMInstructionPayload,
  type GeneralAgentCallLLMResultPayload,
  type GeneralAgentCallToolResultPayload,
  type GeneralAgentCallToolsBatchInstructionPayload,
  type GeneralAgentCompressionResultPayload,
  type GeneralAgentConfig,
  type HumanAbortPayload,
  type SubAgentResultPayload,
  type SubAgentsBatchResultPayload,
} from '../types';
import { shouldCompress } from '../utils/tokenCounter';

const TOOL_NOT_ALLOWED_CONTENT =
  'Tool execution blocked because the tool is not allowed in the current execution scope.';
const TOOL_NOT_ALLOWED_REASON = 'tool_not_allowed';
// Leave 35% of the model window for server-side context engineering (system
// role, knowledge, memories, skills, etc.) and the model's completion. The
// initial 50% threshold still supplies the lower side of the hysteresis band.
const DEFAULT_RECOMPRESSION_THRESHOLD_RATIO = 0.65;

/**
 * ChatAgent - The "Brain" of the chat agent
 *
 * This agent implements a simple but powerful decision loop:
 * 1. user_input → call_llm (with optional RAG/Search preprocessing)
 * 2. llm_result → check for tool_calls and intervention requirements
 *    - Tools not requiring intervention → call_tools_batch (execute immediately)
 *    - Tools requiring intervention → request_human_approve (wait for approval)
 *    - Mixed (both types) → [call_tools_batch, request_human_approve] (execute safe ones first, then request approval)
 *    - No tool_calls → finish
 * 3. tools_batch_result → call_llm (process tool results)
 *
 */
export class GeneralChatAgent implements Agent {
  private config: GeneralAgentConfig;

  constructor(config: GeneralAgentConfig) {
    this.config = config;
  }

  private getTools(state: AgentState, fallbackTools?: any[]): any[] | undefined {
    return this.config.tools ?? state.tools ?? state.operationToolSet?.tools ?? fallbackTools;
  }

  private getAllowedToolNamesPayload() {
    return this.config.allowedToolNames === undefined
      ? {}
      : { allowedToolNames: this.config.allowedToolNames };
  }

  private partitionToolsByAllowList(toolsCalling: ChatToolPayload[]) {
    // An omitted allow-list preserves unrestricted behavior; an explicit empty list blocks all tools.
    if (this.config.allowedToolNames === undefined) {
      return { allowedTools: toolsCalling, blockedTools: [] };
    }

    const allowedToolNames = new Set(this.config.allowedToolNames);
    const toolNameResolver = new ToolNameResolver();
    const allowedTools: ChatToolPayload[] = [];
    const blockedTools: ChatToolPayload[] = [];

    for (const tool of toolsCalling) {
      const toolName = toolNameResolver.generate(tool.identifier, tool.apiName, tool.type);
      (allowedToolNames.has(toolName) ? allowedTools : blockedTools).push(tool);
    }

    return { allowedTools, blockedTools };
  }

  /**
   * Get intervention configuration for a specific tool call
   */
  private getToolInterventionConfig(
    toolCalling: ChatToolPayload,
    state: AgentState,
  ): ExtendedHumanInterventionConfig | undefined {
    const { identifier, apiName } = toolCalling;
    const manifest = state.toolManifestMap[identifier];

    if (!manifest) return undefined;

    // Find the specific API in the manifest
    const api = manifest.api?.find((a: any) => a.name === apiName);

    // API-level config takes precedence over tool-level config
    return api?.humanIntervention ?? manifest.humanIntervention;
  }

  private isDynamicInterventionConfig(
    config: ExtendedHumanInterventionConfig | undefined,
  ): config is {
    dynamic: { default?: HumanInterventionPolicy; policy?: HumanInterventionPolicy; type: string };
  } {
    return !!config && typeof config === 'object' && !Array.isArray(config) && 'dynamic' in config;
  }

  private resolveDynamicPolicy(
    config: ExtendedHumanInterventionConfig | undefined,
    toolArgs: Record<string, any>,
    metadata?: Record<string, any>,
  ): Promise<HumanInterventionPolicy | undefined> {
    if (!this.isDynamicInterventionConfig(config)) {
      return Promise.resolve(undefined);
    }

    const { dynamic } = config;
    const resolver = this.config.dynamicInterventionAudits?.[dynamic.type];

    if (!resolver) return Promise.resolve(dynamic.default ?? 'never');

    return Promise.resolve(resolver(toolArgs, metadata)).then((shouldIntervene) =>
      shouldIntervene ? (dynamic.policy ?? 'always') : (dynamic.default ?? 'never'),
    );
  }

  /**
   * Check if tool calls need human intervention
   * Combines user's global config with tool's own config
   * Returns [toolsNeedingIntervention, toolsToExecute]
   */
  private async checkInterventionNeeded(
    toolsCalling: ChatToolPayload[],
    state: AgentState,
  ): Promise<[ChatToolPayload[], ChatToolPayload[]]> {
    const toolsNeedingIntervention: ChatToolPayload[] = [];
    const toolsToExecute: ChatToolPayload[] = [];

    // Get security blacklist for resolver metadata
    const securityBlacklist = state.securityBlacklist ?? DEFAULT_SECURITY_BLACKLIST;

    // Build resolver metadata: merge state.metadata with security blacklist
    const resolverMetadata = { ...state.metadata, securityBlacklist };

    // Get user config (default to 'manual' mode)
    const userConfig = state.userInterventionConfig || { approvalMode: 'manual' };
    const { approvalMode, allowList = [] } = userConfig;

    // Global audits: default to security blacklist audit if not provided
    const globalResolvers = this.config.globalInterventionAudits ?? createDefaultGlobalAudits();

    for (const toolCalling of toolsCalling) {
      const { identifier, apiName } = toolCalling;
      const toolKey = `${identifier}/${apiName}`;

      // Parse arguments for intervention checking
      let toolArgs: Record<string, any> = {};
      try {
        toolArgs = JSON.parse(toolCalling.arguments || '{}');
      } catch {
        // Invalid JSON, treat as empty args
      }

      // Phase 1: Run global resolvers (e.g., security blacklist)
      let globalPolicy: HumanInterventionPolicy | undefined;

      // Evaluate every audit and retain the strictest match. Security does not
      // depend on registration order: a preceding `required` match must never
      // hide a later non-bypassable `always` match.
      const policyRank: Record<HumanInterventionPolicy, number> = {
        always: 2,
        never: 0,
        required: 1,
      };
      for (const globalResolver of globalResolvers) {
        if (await globalResolver.resolver(toolArgs, resolverMetadata)) {
          const matchedPolicy = globalResolver.policy ?? 'always';
          if (!globalPolicy || policyRank[matchedPolicy] > policyRank[globalPolicy]) {
            globalPolicy = matchedPolicy;
          }
        }
      }

      // Global `always` is non-bypassable in every interactive mode (headless
      // is converted to a blocked tool result by the runner).
      if (globalPolicy === 'always') {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 2.5: Get manifest for later use
      const manifest = state.toolManifestMap?.[identifier];

      // Phase 3: Per-tool dynamic resolver
      const config = this.getToolInterventionConfig(toolCalling, state);
      const isDynamicConfig = this.isDynamicInterventionConfig(config);
      const dynamicPolicy = await this.resolveDynamicPolicy(config, toolArgs, state.metadata);
      const staticConfig = isDynamicConfig
        ? undefined
        : (config as HumanInterventionConfig | undefined);
      const staticPolicy = InterventionChecker.shouldIntervene({
        config: staticConfig,
        // Global audits already performed the security pass above. Passing an
        // explicit empty list reuses the canonical rule matcher without
        // re-running the default blacklist or maintaining a divergent matcher.
        securityBlacklist: [],
        toolArgs,
      });

      if (dynamicPolicy !== undefined) {
        if (dynamicPolicy === 'always') {
          toolsNeedingIntervention.push(toolCalling);
          continue;
        }
      } else if (staticPolicy === 'always') {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // auto-run/headless bypass `required` policies, but never `always`
      // (already handled above).
      if (approvalMode === 'headless' || approvalMode === 'auto-run') {
        toolsToExecute.push(toolCalling);
        continue;
      }

      // A global `required` audit is stronger than a per-tool dynamic `never`.
      // It remains mandatory in manual/allow-list modes; previously the early
      // dynamic branch could silently execute the audited call.
      if (globalPolicy === 'required') {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      if (dynamicPolicy !== undefined) {
        if (dynamicPolicy === 'never') toolsToExecute.push(toolCalling);
        else if (approvalMode === 'allow-list' && allowList.includes(toolKey))
          toolsToExecute.push(toolCalling);
        else toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 5.5: Unknown tool guard — require intervention for tools not in manifest
      // Only applies to manual/allow-list modes; auto-run users accept the risk
      if (!manifest) {
        console.warn(
          `[InterventionGuard] Unknown tool "${identifier}/${apiName}" not found in toolManifestMap (keys: ${Object.keys(state.toolManifestMap ?? {}).join(', ')}), requiring intervention`,
        );
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 6: User config is 'allow-list', check if tool is in whitelist
      if (approvalMode === 'allow-list') {
        if (allowList.includes(toolKey)) {
          toolsToExecute.push(toolCalling);
        } else {
          toolsNeedingIntervention.push(toolCalling);
        }
        continue;
      }

      // Phase 7: User config is 'manual' (default), use tool's own config
      if (staticPolicy === 'never') {
        toolsToExecute.push(toolCalling);
      } else {
        toolsNeedingIntervention.push(toolCalling);
      }
    }

    return [toolsNeedingIntervention, toolsToExecute];
  }

  /**
   * Extract abort information from current context and state
   * Returns the necessary data to handle abort scenario
   */
  private extractAbortInfo(context: AgentRuntimeContext, state: AgentState) {
    let hasToolsCalling = false;
    let toolsCalling: ChatToolPayload[] = [];
    let parentMessageId = '';
    /**
     * `tool_call_id → existing tool message id` for pending rows the approval
     * pause already wrote. Carried to `resolve_aborted_tools` so it settles
     * those rows instead of inserting duplicates beside them.
     */
    let existingToolMessageIds: Record<string, string> | undefined;

    // Extract abort info based on current phase
    switch (context.phase) {
      case 'llm_result': {
        const payload = context.payload as GeneralAgentCallLLMResultPayload;
        hasToolsCalling = payload.hasToolsCalling || false;
        toolsCalling = payload.toolsCalling || [];
        parentMessageId = payload.parentMessageId;
        break;
      }
      case 'human_abort': {
        // When user cancels during LLM streaming, we enter human_abort phase
        // The payload contains tool calls info if LLM had started returning them
        const payload = context.payload as any;
        hasToolsCalling = payload.hasToolsCalling || false;
        toolsCalling = payload.toolsCalling || [];
        parentMessageId = payload.parentMessageId;
        break;
      }
      case 'tool_result':
      case 'tools_batch_result': {
        const payload = context.payload as GeneralAgentCallToolResultPayload;
        parentMessageId = payload.parentMessageId;
        // Check if there are pending tool messages. Deliberately UN-scoped
        // (unlike the loop guard): an abort must cancel every pending row it
        // can see, including one whose owning assistant isn't in this state
        // snapshot — leaving it pending strands it forever.
        const pendingToolMessages = this.collectPendingToolMessages(state);
        if (pendingToolMessages.length > 0) {
          hasToolsCalling = true;
          toolsCalling = pendingToolMessages.map((m: any) => m.plugin).filter(Boolean);
          existingToolMessageIds = Object.fromEntries(
            pendingToolMessages
              .filter((m: any) => m.plugin?.id && m.id)
              .map((m: any) => [m.plugin.id, m.id]),
          );
        }
        break;
      }
    }

    return { existingToolMessageIds, hasToolsCalling, parentMessageId, toolsCalling };
  }

  /**
   * Pending-tool scope guard for the main loop.
   *
   * The pending-approval check must only count tool messages produced by the
   * **current** assistant turn. Stale `pluginIntervention.status === 'pending'`
   * rows from a previous turn (e.g. an abandoned approval flow whose user
   * never clicked approve/reject) get loaded back into `state.messages` via
   * `historyMessages` and would otherwise hijack every subsequent
   * `tool_result` / `tools_batch_result` phase, parking the loop in
   * `waiting_for_human` forever.
   *
   * "Current turn" = the most recent assistant message that emitted tool calls,
   * stored as either model-native `tool_calls` or persisted `tools`. All pending
   * tool messages legitimately belonging to this turn have
   * `parentId === currentAssistantId`.
   *
   * Two message shapes reach this method and BOTH must be handled:
   *
   * 1. **Raw shape** (client runtime, and any step that never round-tripped
   *    through the DB): a `role: 'assistant'` row carrying `tools` /
   *    `tool_calls`, followed by sibling `role: 'tool'` rows whose
   *    `pluginIntervention.status` is the approval state.
   * 2. **Parsed shape** (server runtime): `AgentRuntimeService` rebuilds
   *    `state.messages` from the DB through `conversation-flow`'s `parse()` on
   *    every step entry, and `FlatListBuilder` folds an assistant plus its tool
   *    rows into ONE `role: 'assistantGroup'` virtual message. In that shape
   *    there is no `role: 'assistant'` row carrying tools and no top-level
   *    `role: 'tool'` row at all — the tool calls live in
   *    `children[].tools[]`, each carrying `intervention` and `result_msg_id`.
   *
   * Matching only shape 1 made this guard a no-op on the entire server runtime:
   * approving one tool of a parallel batch resumed the LLM immediately while the
   * other N-1 tool rows were still `pending` with empty content, so the model
   * saw blank tool results and (visibly, in reproduction) re-issued the whole
   * batch. Every parallel-approval defect downstream of that — forked parent
   * chains, duplicate batches — starts here.
   */
  private getCurrentTurnPendingToolMessages(state: AgentState): any[] {
    const messages = (state.messages ?? []) as any[];

    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];

      // Shape 2 — parsed `assistantGroup`. Read the folded tool entries; their
      // `result_msg_id` is the tool message id the approval flow addresses.
      if (this.isFoldedAssistantGroup(m)) {
        return this.pendingToolMessagesFromGroup(m);
      }

      // Shape 1 — raw assistant + sibling tool rows.
      if (m.role === 'assistant' && (m.tool_calls?.length > 0 || m.tools?.length > 0)) {
        return messages.filter(
          (t: any) =>
            t.role === 'tool' && t.pluginIntervention?.status === 'pending' && t.parentId === m.id,
        );
      }
    }

    return [];
  }

  /**
   * Build the partial-decision parking instruction from authoritative message
   * rows. The plain tool payload intentionally omits renderer-only intervention
   * fields, so correlation travels beside it as a server-only supersession
   * descriptor. A partially stamped or cross-batch set fails closed instead of
   * creating a second independently actionable Review.
   */
  private buildPendingApprovalRepark(pendingToolMessages: any[]): AgentInstruction {
    const parentIds = new Set(
      pendingToolMessages
        .map((message) => message.parentId)
        .filter((parentId): parentId is string => typeof parentId === 'string' && !!parentId),
    );
    if (parentIds.size !== 1) {
      throw new Error('Cannot re-park interventions without one authoritative assistant owner');
    }

    const pendingTools = pendingToolMessages
      .map((message: any) => message.plugin)
      .filter(Boolean) as ChatToolPayload[];
    const previousIdentities = pendingToolMessages.map((message: any) => ({
      batchId: message.pluginIntervention?.batchId,
      operationId: message.pluginIntervention?.operationId,
      toolCallId: message.tool_call_id ?? message.plugin?.id,
    }));
    const hasDurableIdentity = previousIdentities.some(
      ({ batchId, operationId }) => batchId || operationId,
    );
    let supersedes: Extract<AgentInstruction, { type: 'request_human_approve' }>['supersedes'];
    if (hasDurableIdentity) {
      const first = previousIdentities[0];
      if (
        typeof first.batchId !== 'string' ||
        !first.batchId ||
        typeof first.operationId !== 'string' ||
        !first.operationId ||
        previousIdentities.some(
          (identity) =>
            identity.batchId !== first.batchId ||
            identity.operationId !== first.operationId ||
            typeof identity.toolCallId !== 'string' ||
            !identity.toolCallId,
        )
      ) {
        throw new Error('Cannot re-park a partial or mixed durable intervention batch');
      }
      supersedes = {
        batchId: first.batchId,
        operationId: first.operationId,
        toolCallIds: previousIdentities.map(({ toolCallId }) => toolCallId as string),
      };
    }

    return {
      parentMessageId: [...parentIds][0],
      pendingToolsCalling: pendingTools,
      reason: 'Some tools still pending approval',
      skipCreateToolMessage: true,
      ...(supersedes && { supersedes }),
      type: 'request_human_approve',
    };
  }

  /**
   * Every pending tool message visible in `state.messages`, across BOTH shapes
   * and WITHOUT turn scoping.
   *
   * Used by the abort path, whose contract is the inverse of the loop guard's:
   * the guard must ignore stale rows so they can't park the loop forever, while
   * an abort must resolve every pending row it can reach — including one whose
   * owning assistant is absent from this snapshot — or that row stays `pending`
   * with no runtime left to settle it.
   */
  private collectPendingToolMessages(state: AgentState): any[] {
    const messages = (state.messages ?? []) as any[];

    return messages.flatMap((m: any) => {
      if (this.isFoldedAssistantGroup(m)) return this.pendingToolMessagesFromGroup(m);
      if (m.role === 'tool' && m.pluginIntervention?.status === 'pending') return [m];
      return [];
    });
  }

  private isFoldedAssistantGroup(message: any): boolean {
    return (
      (message?.role === 'assistantGroup' || message?.role === 'supervisor') &&
      (message.children ?? []).some((child: any) => child.tools?.length > 0)
    );
  }

  /**
   * Normalize an `assistantGroup`'s folded tool entries back into the tool-row
   * shape the rest of the runner expects (`plugin`, `pluginIntervention`,
   * `parentId`), keeping only the pending ones.
   */
  private pendingToolMessagesFromGroup(group: any): any[] {
    return (group.children ?? [])
      .flatMap((child: any) => child.tools ?? [])
      .filter((tool: any) => tool.intervention?.status === 'pending')
      .map((tool: any) => {
        // Drop the display-only fields FlatListBuilder merges onto the entry so
        // `plugin` is a plain ChatToolPayload — the same shape the raw path
        // produces, and what `request_human_approve` / `call_tool` expect.
        const { intervention, result: _result, result_msg_id, ...plugin } = tool;
        return {
          id: result_msg_id,
          parentId: group.id,
          plugin: plugin as ChatToolPayload,
          pluginIntervention: intervention,
          role: 'tool',
          tool_call_id: tool.id,
        };
      });
  }

  /**
   * Find existing compression summary from messages
   * Looks for MessageGroup with type 'compression' and extracts its content
   */
  private findExistingSummary(messages: any[]): string | undefined {
    const compressedGroupSummaries = messages
      .filter(
        (message) =>
          (message.role === 'compressedGroup' || message.messageGroupType === 'compression') &&
          message.content,
      )
      .map((message) => message.content as string);

    if (compressedGroupSummaries.length > 0) return compressedGroupSummaries.join('\n\n');

    // Keep compatibility with the legacy system-message summary representation.
    for (let index = messages.length - 1; index >= 0; index--) {
      const msg = messages[index];
      if (msg.role === 'system' && msg.metadata?.compressionSummary) {
        return msg.content;
      }
    }
    return undefined;
  }

  /**
   * Use hysteresis after the first compression. A freshly compressed context can
   * sit just below the ordinary threshold; applying the same threshold again
   * makes one small tool result trigger another compression before the model can
   * act on it. Keep the initial threshold conservative, then allow the compressed
   * context to grow to a higher watermark before compressing it again.
   */
  private getCompressionThresholdRatio(messages: any[]): number | undefined {
    const initialRatio = this.config.compressionConfig?.thresholdRatio;
    if (!this.findExistingSummary(messages)) return initialRatio;

    const configuredRecompressionRatio = this.config.compressionConfig?.recompressionThresholdRatio;
    if (configuredRecompressionRatio !== undefined) return configuredRecompressionRatio;

    return Math.max(initialRatio ?? 0, DEFAULT_RECOMPRESSION_THRESHOLD_RATIO);
  }

  /**
   * Proceed to the next LLM call, inserting compression first when needed.
   */
  private toLLMCall(
    payload: GeneralAgentCallLLMInstructionPayload,
    state: AgentState,
  ): AgentInstruction {
    const payloadWithAllowedToolNames = {
      ...payload,
      ...this.getAllowedToolNamesPayload(),
    };
    const compressionEnabled = this.config.compressionConfig?.enabled ?? true;
    // Mirror RuntimeExecutors.callLlm: when state.forceFinish is set, the
    // executor strips all tools via buildStepToolDelta (deactivatedToolIds: ['*']),
    // so they must not count against the compression budget either — otherwise
    // we'd burn an extra summarization pass on tool tokens that won't be sent.
    const compressionOptions = {
      maxWindowToken: this.config.compressionConfig?.maxWindowToken,
      thresholdRatio: this.getCompressionThresholdRatio(payloadWithAllowedToolNames.messages),
      tools: state.forceFinish ? undefined : payloadWithAllowedToolNames.tools,
    };

    if (compressionEnabled) {
      const messages = payloadWithAllowedToolNames.messages;
      const compressionCheck = shouldCompress(messages, compressionOptions);

      if (compressionCheck.needsCompression) {
        return {
          payload: {
            currentTokenCount: compressionCheck.currentTokenCount,
            existingSummary: this.findExistingSummary(messages),
            messages,
          },
          type: 'compress_context',
        };
      }
    }

    return {
      payload: payloadWithAllowedToolNames,
      type: 'call_llm',
    };
  }

  /**
   * Handle abort scenario - unified abort handling logic
   */
  private handleAbort(
    context: AgentRuntimeContext,
    state: AgentState,
  ): AgentInstruction | AgentInstruction[] {
    const { existingToolMessageIds, hasToolsCalling, parentMessageId, toolsCalling } =
      this.extractAbortInfo(context, state);

    // If there are pending tool calls, resolve them
    if (hasToolsCalling && toolsCalling.length > 0) {
      return {
        payload: { existingToolMessageIds, parentMessageId, toolsCalling },
        type: 'resolve_aborted_tools',
      };
    }

    // No tools to resolve, directly finish
    return {
      reason: 'user_requested',
      reasonDetail: 'Operation cancelled by user',
      type: 'finish',
    };
  }

  async runner(
    context: AgentRuntimeContext,
    state: AgentState,
  ): Promise<AgentInstruction | AgentInstruction[]> {
    // Unified abort check: if operation is interrupted, handle abort scenario
    // This check is placed before phase handling to ensure consistent abort behavior
    if (state.status === 'interrupted') {
      return this.handleAbort(context, state);
    }

    switch (context.phase) {
      case 'init':
      case 'user_input': {
        // Check if context compression is enabled and needed before calling LLM
        const compressionEnabled = this.config.compressionConfig?.enabled ?? true; // Default to enabled
        // Mirror RuntimeExecutors.callLlm: force-finish steps ship without tools,
        // so they must not count against the compression budget here either.
        const compressionOptions = {
          maxWindowToken: this.config.compressionConfig?.maxWindowToken,
          thresholdRatio: this.getCompressionThresholdRatio(state.messages),
          tools: state.forceFinish ? undefined : this.getTools(state),
        };

        if (compressionEnabled) {
          const compressionCheck = shouldCompress(state.messages, compressionOptions);

          if (compressionCheck.needsCompression) {
            // Context exceeds threshold, compress ALL messages into a single summary
            return {
              payload: {
                currentTokenCount: compressionCheck.currentTokenCount,
                existingSummary: this.findExistingSummary(state.messages),
                messages: state.messages,
              },
              type: 'compress_context',
            } as AgentInstructionCompressContext;
          }
        }

        // User input received, call LLM to generate response
        // At this point, messages may have been preprocessed with RAG/Search
        const basePayload = context.payload as any;
        const tools = this.getTools(state, basePayload?.tools);
        return {
          payload: {
            ...basePayload,
            ...this.getAllowedToolNamesPayload(),
            messages: state.messages,
            tools,
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'llm_result': {
        // LLM response received, check if it contains tool calls
        const { hasToolsCalling, toolsCalling, parentMessageId, result } =
          context.payload as GeneralAgentCallLLMResultPayload;

        if (hasToolsCalling && toolsCalling && toolsCalling.length > 0) {
          const { allowedTools, blockedTools } = this.partitionToolsByAllowList(toolsCalling);
          // Check which tools need human intervention
          const [toolsNeedingIntervention, toolsToExecute] = await this.checkInterventionNeeded(
            allowedTools,
            state,
          );

          const instructions: AgentInstruction[] = [];

          // Execute tools that don't need intervention first
          // These will run immediately before any approval requests
          if (toolsToExecute.length > 0) {
            if (toolsToExecute.length > 1) {
              instructions.push({
                payload: {
                  parentMessageId,
                  toolsCalling: toolsToExecute,
                } as GeneralAgentCallToolsBatchInstructionPayload,
                type: 'call_tools_batch',
              });
            } else {
              instructions.push({
                payload: {
                  parentMessageId,
                  toolCalling: toolsToExecute[0],
                } as GeneralAgentCallingToolInstructionPayload,
                type: 'call_tool',
              });
            }
          }

          // Resolve denied tools before an approval request parks the runtime.
          if (blockedTools.length > 0) {
            instructions.push({
              payload: {
                blockedContent: TOOL_NOT_ALLOWED_CONTENT,
                blockedReason: TOOL_NOT_ALLOWED_REASON,
                parentMessageId,
                toolsCalling: blockedTools,
              },
              type: 'resolve_blocked_tools',
            } satisfies AgentInstruction);
          }

          // Request approval for tools that need intervention
          // Non-headless mode waits for human approval; headless mode returns blocked tool results.
          if (toolsNeedingIntervention.length > 0) {
            if (state.userInterventionConfig?.approvalMode === 'headless') {
              instructions.push({
                payload: {
                  parentMessageId,
                  toolsCalling: toolsNeedingIntervention,
                },
                type: 'resolve_blocked_tools',
              } satisfies AgentInstruction);
            } else {
              instructions.push({
                // Same `parentMessageId` the sibling call_tool / call_tools_batch
                // instructions carry: the assistant message this llm_result just
                // produced. Naming the owner explicitly keeps it resolvable
                // across a step boundary — after rehydration that assistant
                // comes back as an `assistantGroup`, which the executor's
                // role-only fallback scan skips (see `executors/humanApprove.ts`).
                parentMessageId,
                pendingToolsCalling: toolsNeedingIntervention,
                reason: 'human_intervention_required',
                type: 'request_human_approve',
              });
            }
          }

          return instructions;
        }

        // Silent-drop diagnostic: LLM emitted raw tool_calls but every one
        // failed to resolve to a known tool (e.g. malformed names without the
        // `____` separator). Surface this in reasonDetail so dashboards can
        // distinguish it from a genuine no-tool completion. See .
        const rawToolCallCount = result?.tool_calls?.length ?? 0;
        const hasUnresolvedToolCalls = rawToolCallCount > 0;

        // No tool calls, conversation is complete
        return {
          reason: state.forceFinish ? 'max_steps_completed' : 'completed',
          reasonDetail: hasUnresolvedToolCalls
            ? `LLM returned ${rawToolCallCount} unresolvable tool_calls: ${(
                result?.tool_calls ?? []
              )
                .map((tc) => tc.function?.name)
                .filter(Boolean)
                .join(', ')}`
            : state.forceFinish
              ? 'Force finish: LLM produced final text response after max steps'
              : 'LLM response completed without tool calls',
          type: 'finish',
        };
      }

      case 'tool_result': {
        const { data, parentMessageId, stop } =
          context.payload as GeneralAgentCallToolResultPayload;

        // Legacy async agent invocation path. `callAgent({ runAsTask: true })`
        // emits state.type=execSubAgent* with stop=true so the runtime can fork
        // a background agent run after the tool call is persisted.
        if (stop && data?.state) {
          const stateType = data.state.type;

          // Server-side legacy agent invocation (single)
          if (stateType === 'execSubAgent') {
            const { parentMessageId: execParentId, task } = data.state as {
              parentMessageId: string;
              task: any;
            };
            return {
              payload: { parentMessageId: execParentId, task },
              type: 'exec_sub_agent',
            };
          }

          // Server-side legacy agent invocations (multiple)
          if (stateType === 'execSubAgents') {
            const { parentMessageId: execParentId, tasks } = data.state as {
              parentMessageId: string;
              tasks: any[];
            };
            return {
              payload: { parentMessageId: execParentId, tasks },
              type: 'exec_sub_agents',
            };
          }
        }

        // Scope pending check to the current assistant turn so stale
        // `pending` rows from prior turns can never block the loop.
        const pendingToolMessages = this.getCurrentTurnPendingToolMessages(state);

        // If there are pending tools, wait for human approval
        if (pendingToolMessages.length > 0) {
          return this.buildPendingApprovalRepark(pendingToolMessages);
        }

        if (context.stepContext?.hasQueuedMessages) {
          return { reason: 'queued_message_interrupt', type: 'finish' };
        }

        // No pending tools, continue to call LLM with tool results.
        // When this operation resumed by executing a tool first (e.g. the tools
        // activator), reuse the placeholder seeded for that resume so this turn
        // fills it instead of orphaning it (undefined for normal turns).
        return this.toLLMCall(
          {
            assistantMessageId: state.pendingAssistantMessageId,
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: this.getTools(state),
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'tools_batch_result': {
        const { parentMessageId } = context.payload as GeneralAgentCallToolResultPayload;

        // Scope pending check to the current assistant turn so stale
        // `pending` rows from prior turns can never block the loop.
        const pendingToolMessages = this.getCurrentTurnPendingToolMessages(state);

        // If there are pending tools, wait for human approval
        if (pendingToolMessages.length > 0) {
          return this.buildPendingApprovalRepark(pendingToolMessages);
        }

        // If there are queued user messages, finish early so the queue
        // can be processed as a new operation with full context
        if (context.stepContext?.hasQueuedMessages) {
          return { reason: 'queued_message_interrupt', type: 'finish' };
        }

        // No pending tools, continue to call LLM with tool results.
        // When this operation resumed by executing a tool first (e.g. the tools
        // activator), reuse the placeholder seeded for that resume so this turn
        // fills it instead of orphaning it (undefined for normal turns).
        return this.toLLMCall(
          {
            assistantMessageId: state.pendingAssistantMessageId,
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: this.getTools(state),
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'sub_agent_result': {
        // Single sub-agent completed, continue to call LLM with result
        const { parentMessageId } = context.payload as SubAgentResultPayload;

        // Continue to call LLM with the latest state after the sub-agent run.
        return this.toLLMCall(
          {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: this.getTools(state),
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'sub_agents_batch_result': {
        // Sub-agents batch completed, continue to call LLM with results
        const { parentMessageId } = context.payload as SubAgentsBatchResultPayload;

        if (context.stepContext?.hasQueuedMessages) {
          return { reason: 'queued_message_interrupt', type: 'finish' };
        }

        // Inject a virtual user message to force the model to summarize or continue.
        // This fixes an issue where some models (e.g., Kimi K2) return empty content
        // when the last message is a sub-agent result, thinking the task is already done.
        const messagesWithPrompt = [
          ...state.messages,
          {
            content:
              'All tasks above have been completed. Please summarize the results or continue with your response following user query language.',
            role: 'user' as const,
          },
        ];

        // Continue to call LLM with the latest state after the sub-agent runs.
        return this.toLLMCall(
          {
            messages: messagesWithPrompt,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: this.getTools(state),
          } as GeneralAgentCallLLMInstructionPayload,
          state,
        );
      }

      case 'compression_result': {
        // Context compression completed, continue to call LLM
        const compressionPayload = context.payload as GeneralAgentCompressionResultPayload;
        const tools = this.getTools(state);

        // A tool-first resume seeds an assistant placeholder that the first
        // post-tool LLM turn must fill. When that turn is large enough to
        // compress first, the compress_context step (not a call_llm) leaves the
        // seed unconsumed, so it reaches here still set — reuse it instead of
        // forcing a new message, otherwise the placeholder is orphaned for
        // exactly the high-context cases that trigger compression.
        //
        // If compression was skipped (no messages to compress), just call LLM.
        // Otherwise, messages have been updated with compressed content, and a
        // normal turn forces a fresh assistant message.
        const seededAssistantMessageId = state.pendingAssistantMessageId;

        return {
          payload: {
            ...(seededAssistantMessageId
              ? { assistantMessageId: seededAssistantMessageId }
              : // Force create new assistant message after compression
                { createAssistantMessage: true }),
            messages: compressionPayload.compressedMessages ?? state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId: compressionPayload.parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools,
            ...this.getAllowedToolNamesPayload(),
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'human_abort': {
        // User aborted the operation
        const { hasToolsCalling, parentMessageId, toolsCalling, reason } =
          context.payload as HumanAbortPayload;

        // If there are pending tool calls, resolve them. No
        // `existingToolMessageIds` here on purpose: this phase is an abort
        // DURING llm streaming, where the calls came off the stream and no tool
        // row has been written yet — the executor must insert.
        if (hasToolsCalling && toolsCalling && toolsCalling.length > 0) {
          return {
            payload: { parentMessageId, toolsCalling },
            type: 'resolve_aborted_tools',
          };
        }

        // No tools to resolve, directly finish
        return { reason: 'user_requested', reasonDetail: reason, type: 'finish' };
      }

      case 'error': {
        // Error occurred, finish execution
        const { error } = context.payload as { error: any };
        return {
          reason: 'error_recovery',
          reasonDetail: error?.message || 'Unknown error occurred',
          type: 'finish',
        };
      }

      default: {
        // Unknown phase, finish execution
        return {
          reason: 'agent_decision',
          reasonDetail: `Unknown phase: ${context.phase}`,
          type: 'finish',
        };
      }
    }
  }
}
