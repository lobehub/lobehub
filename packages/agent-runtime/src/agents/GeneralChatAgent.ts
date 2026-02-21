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
  type TaskResultPayload,
  type TasksBatchResultPayload,
} from '../types';
import { shouldCompress } from '../utils/tokenCounter';

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

  private matchesAlwaysPolicy(
    config: HumanInterventionConfig | undefined,
    toolArgs: Record<string, any>,
  ): boolean {
    if (!config) return false;
    if (config === 'always') return true;
    if (!Array.isArray(config)) return false;

    return config.some((rule) => {
      if (rule.policy !== 'always') return false;
      if (!rule.match) return true;

      return Object.entries(rule.match).every(([paramName, matcher]) => {
        const paramValue = toolArgs[paramName];
        if (paramValue === undefined) return false;

        if (typeof matcher === 'string') {
          return String(paramValue).includes(matcher) || matcher.includes('*');
        }

        return true;
      });
    });
  }

  private resolveDynamicPolicy(
    config: ExtendedHumanInterventionConfig | undefined,
    toolArgs: Record<string, any>,
    metadata?: Record<string, any>,
  ): HumanInterventionPolicy | undefined {
    if (!this.isDynamicInterventionConfig(config)) {
      return undefined;
    }

    const { dynamic } = config;
    const resolver = this.config.dynamicInterventionAudits?.[dynamic.type];

    if (!resolver) return dynamic.default ?? 'never';

    const shouldIntervene = resolver(toolArgs, metadata);
    return shouldIntervene ? (dynamic.policy ?? 'always') : (dynamic.default ?? 'never');
  }

  /**
   * Check if tool calls need human intervention
   * Combines user's global config with tool's own config
   * Returns [toolsNeedingIntervention, toolsToExecute]
   */
  private checkInterventionNeeded(
    toolsCalling: ChatToolPayload[],
    state: AgentState,
  ): [ChatToolPayload[], ChatToolPayload[]] {
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
      let globalBlocked = false;
      let globalPolicy: HumanInterventionPolicy = 'always';

      for (const globalResolver of globalResolvers) {
        if (globalResolver.resolver(toolArgs, resolverMetadata)) {
          globalBlocked = true;
          globalPolicy = globalResolver.policy ?? 'always';
          break;
        }
      }

      // Phase 2: Headless mode - fully automated for async tasks
      if (approvalMode === 'headless') {
        if (globalBlocked && globalPolicy === 'always') {
          // Skip 'always' blocked tools entirely (don't execute, don't wait for approval)
          continue;
        }
        // All other tools execute directly (including overridable global blocks)
        toolsToExecute.push(toolCalling);
        continue;
      }

      // For non-headless modes: 'always' global block requires intervention unconditionally
      if (globalBlocked && globalPolicy === 'always') {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 3: Per-tool dynamic resolver
      const config = this.getToolInterventionConfig(toolCalling, state);
      const isDynamicConfig = this.isDynamicInterventionConfig(config);
      const dynamicPolicy = this.resolveDynamicPolicy(config, toolArgs, state.metadata);
      const staticConfig = isDynamicConfig
        ? undefined
        : (config as HumanInterventionConfig | undefined);

      if (dynamicPolicy !== undefined) {
        if (dynamicPolicy === 'never') {
          toolsToExecute.push(toolCalling);
        } else {
          toolsNeedingIntervention.push(toolCalling);
        }
        continue;
      }

      // Phase 3.5: Handle overridable global block (policy !== 'always')
      if (globalBlocked && globalPolicy !== 'always') {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 4: Check 'always' policy - overrides auto-run mode
      if (this.matchesAlwaysPolicy(staticConfig, toolArgs)) {
        toolsNeedingIntervention.push(toolCalling);
        continue;
      }

      // Phase 5: User config is 'auto-run', all tools execute directly
      if (approvalMode === 'auto-run') {
        toolsToExecute.push(toolCalling);
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
      const policy = InterventionChecker.shouldIntervene({
        config: staticConfig,
        securityBlacklist,
        toolArgs,
      });

      if (policy === 'never') {
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
        // Check if there are pending tool messages
        const pendingToolMessages = state.messages.filter(
          (m: any) => m.role === 'tool' && m.pluginIntervention?.status === 'pending',
        );
        if (pendingToolMessages.length > 0) {
          hasToolsCalling = true;
          toolsCalling = pendingToolMessages.map((m: any) => m.plugin).filter(Boolean);
        }
        break;
      }
    }

    return { hasToolsCalling, parentMessageId, toolsCalling };
  }

  /**
   * Find existing compression summary from messages
   * Looks for MessageGroup with type 'compression' and extracts its content
   */
  private findExistingSummary(messages: any[]): string | undefined {
    // Look for compression group summary in messages
    // The summary is typically stored as a system message with compression metadata
    // or as a MessageGroup content field
    for (const msg of messages) {
      if (msg.role === 'system' && msg.metadata?.compressionSummary) {
        return msg.content;
      }
      // Check for MessageGroup type compression
      if (msg.messageGroupType === 'compression' && msg.content) {
        return msg.content;
      }
    }
    return undefined;
  }

  /**
   * Handle abort scenario - unified abort handling logic
   */
  private handleAbort(
    context: AgentRuntimeContext,
    state: AgentState,
  ): AgentInstruction | AgentInstruction[] {
    const { hasToolsCalling, parentMessageId, toolsCalling } = this.extractAbortInfo(
      context,
      state,
    );

    // If there are pending tool calls, resolve them
    if (hasToolsCalling && toolsCalling.length > 0) {
      return {
        payload: { parentMessageId, toolsCalling },
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

        if (compressionEnabled) {
          const compressionCheck = shouldCompress(state.messages, {
            maxWindowToken: this.config.compressionConfig?.maxWindowToken,
          });

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
        return {
          payload: {
            ...(context.payload as any),
            messages: state.messages,
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'llm_result': {
        // LLM response received, check if it contains tool calls
        const { hasToolsCalling, toolsCalling, parentMessageId } =
          context.payload as GeneralAgentCallLLMResultPayload;

        if (hasToolsCalling && toolsCalling && toolsCalling.length > 0) {
          // Check which tools need human intervention
          const [toolsNeedingIntervention, toolsToExecute] = this.checkInterventionNeeded(
            toolsCalling,
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

          // Request approval for tools that need intervention
          // Runtime will execute this after safe tools and pause with status='waiting_for_human'
          if (toolsNeedingIntervention.length > 0) {
            instructions.push({
              pendingToolsCalling: toolsNeedingIntervention,
              reason: 'human_intervention_required',
              type: 'request_human_approve',
            });
          }

          return instructions;
        }

        // No tool calls, conversation is complete
        return {
          reason: 'completed',
          reasonDetail: 'LLM response completed without tool calls',
          type: 'finish',
        };
      }

      case 'tool_result': {
        const { data, parentMessageId, stop } =
          context.payload as GeneralAgentCallToolResultPayload;

        // Check if this is a GTD async task request (only execTask/execTasks are passed here with stop=true)
        if (stop && data?.state) {
          const stateType = data.state.type;

          // GTD async task (single)
          if (stateType === 'execTask') {
            const { parentMessageId: execParentId, task } = data.state as {
              parentMessageId: string;
              task: any;
            };
            return {
              payload: { parentMessageId: execParentId, task },
              type: 'exec_task',
            };
          }

          // GTD async tasks (multiple)
          if (stateType === 'execTasks') {
            const { parentMessageId: execParentId, tasks } = data.state as {
              parentMessageId: string;
              tasks: any[];
            };
            return {
              payload: { parentMessageId: execParentId, tasks },
              type: 'exec_tasks',
            };
          }

          // GTD client-side async task (single, desktop only)
          if (stateType === 'execClientTask') {
            const { parentMessageId: execParentId, task } = data.state as {
              parentMessageId: string;
              task: any;
            };
            return {
              payload: { parentMessageId: execParentId, task },
              type: 'exec_client_task',
            };
          }

          // GTD client-side async tasks (multiple, desktop only)
          if (stateType === 'execClientTasks') {
            const { parentMessageId: execParentId, tasks } = data.state as {
              parentMessageId: string;
              tasks: any[];
            };
            return {
              payload: { parentMessageId: execParentId, tasks },
              type: 'exec_client_tasks',
            };
          }
        }

        // Check if there are still pending tool messages waiting for approval
        const pendingToolMessages = state.messages.filter(
          (m: any) => m.role === 'tool' && m.pluginIntervention?.status === 'pending',
        );

        // If there are pending tools, wait for human approval
        if (pendingToolMessages.length > 0) {
          const pendingTools = pendingToolMessages.map((m: any) => m.plugin).filter(Boolean);

          return {
            pendingToolsCalling: pendingTools,
            reason: 'Some tools still pending approval',
            skipCreateToolMessage: true,
            type: 'request_human_approve',
          };
        }

        // No pending tools, continue to call LLM with tool results
        return {
          payload: {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'tools_batch_result': {
        const { parentMessageId } = context.payload as GeneralAgentCallToolResultPayload;

        // Check if there are still pending tool messages waiting for approval
        const pendingToolMessages = state.messages.filter(
          (m: any) => m.role === 'tool' && m.pluginIntervention?.status === 'pending',
        );

        // If there are pending tools, wait for human approval
        if (pendingToolMessages.length > 0) {
          const pendingTools = pendingToolMessages.map((m: any) => m.plugin).filter(Boolean);

          return {
            pendingToolsCalling: pendingTools,
            reason: 'Some tools still pending approval',
            skipCreateToolMessage: true,
            type: 'request_human_approve',
          };
        }

        // No pending tools, continue to call LLM with tool results
        return {
          payload: {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'task_result': {
        // Single async task completed, continue to call LLM with result
        const { parentMessageId } = context.payload as TaskResultPayload;

        // Continue to call LLM with updated messages (task message is already in state)
        return {
          payload: {
            messages: state.messages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'tasks_batch_result': {
        // Async tasks batch completed, continue to call LLM with results
        const { parentMessageId } = context.payload as TasksBatchResultPayload;

        // Inject a virtual user message to force the model to summarize or continue
        // This fixes an issue where some models (e.g., Kimi K2) return empty content
        // when the last message is a task result, thinking the task is already done
        const messagesWithPrompt = [
          ...state.messages,
          {
            content:
              'All tasks above have been completed. Please summarize the results or continue with your response following user query language.',
            role: 'user' as const,
          },
        ];

        // Continue to call LLM with updated messages (task messages are already in state)
        return {
          payload: {
            messages: messagesWithPrompt,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'compression_result': {
        // Context compression completed, continue to call LLM
        const compressionPayload = context.payload as GeneralAgentCompressionResultPayload;

        // If compression was skipped (no messages to compress), just call LLM
        // Otherwise, messages have been updated with compressed content
        // Pass parentMessageId and createAssistantMessage=true to force new message creation
        return {
          payload: {
            // Force create new assistant message after compression
            createAssistantMessage: true,
            messages: compressionPayload.compressedMessages,
            model: this.config.modelRuntimeConfig?.model,
            parentMessageId: compressionPayload.parentMessageId,
            provider: this.config.modelRuntimeConfig?.provider,
            tools: state.tools,
          } as GeneralAgentCallLLMInstructionPayload,
          type: 'call_llm',
        };
      }

      case 'human_abort': {
        // User aborted the operation
        const { hasToolsCalling, parentMessageId, toolsCalling, reason } =
          context.payload as HumanAbortPayload;

        // If there are pending tool calls, resolve them
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
