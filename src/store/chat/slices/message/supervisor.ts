import { contextSupervisorMakeDecision } from '@lobechat/prompts';
import { type GroupMemberWithAgent, type UIChatMessage } from '@lobechat/types';

import { aiChatService } from '@/services/aiChat';

export interface SupervisorDecision {
  id: string;
  // target agent ID or "user" for DM, omit for group message
  instruction?: string;
  // agent ID who should respond
  target?: string; // optional instruction from supervisor to the agent
}

export type SupervisorDecisionList = SupervisorDecision[]; // Empty array = stop conversation

export interface SupervisorTodoItem {
  // optional assigned owner (agent id or name)
  assignee?: string;
  content: string;
  finished: boolean;
}

export interface SupervisorDecisionResult {
  decisions: SupervisorDecisionList;
  todos: SupervisorTodoItem[];
  todoUpdated: boolean;
}

export type SupervisorToolName =
  | 'create_todo'
  | 'finish_todo'
  | 'wait_for_user_input'
  | 'trigger_agent'
  | 'trigger_agent_dm';

export interface SupervisorToolCall {
  parameter?: unknown;
  tool_name: SupervisorToolName;
}

export interface SupervisorContext {
  abortController?: AbortController;
  allowDM?: boolean;
  availableAgents: GroupMemberWithAgent[];
  groupId: string;
  messages: UIChatMessage[];
  model: string;
  provider: string;
  // Group scene controls which tools are exposed (e.g., todos only in 'productive')
  scene?: 'casual' | 'productive';
  systemPrompt?: string;
  todoList?: SupervisorTodoItem[];
  userName?: string;
}

/**
 * Core supervisor runtime that orchestrates the conversation between agents in group chat
 */
export class GroupChatSupervisor {
  /**
   * Make decision on who should speak next
   */
  async makeDecision(context: SupervisorContext): Promise<SupervisorDecisionResult> {
    const { availableAgents } = context;

    // If no agents available, stop conversation
    if (availableAgents.length === 0) {
      return { decisions: [], todoUpdated: false, todos: [] };
    }

    try {
      const response = await this.callLLMForDecision(context);
      const result = this.parseSupervisorResponse(response, availableAgents, context);

      console.log('Supervisor TODO list:', result.todos);

      return result;
    } catch (error) {
      // Re-throw the error so it can be caught and displayed to the user via toast
      throw new Error(
        `Supervisor decision failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Call LLM service to get supervisor decision
   */
  private async callLLMForDecision(
    context: SupervisorContext,
  ): Promise<SupervisorToolCall[] | string> {
    const contexts = contextSupervisorMakeDecision({
      allowDM: context.allowDM,
      availableAgents: context.availableAgents
        .filter((agent) => agent.id)
        .map((agent) => ({ id: agent.id, title: agent.title })),
      messages: context.messages,
      scene: context.scene,
      todoList: context.todoList,
      userName: context.userName,
    });

    try {
      const response = await aiChatService.generateJSON(
        {
          ...(contexts as any),
          model: context.model,
          provider: context.provider,
        },
        context.abortController || new AbortController(),
      );

      console.log('SUPERVISOR RESPONSE', JSON.stringify(response, null, 2));

      // Parse the response to SupervisorToolCall[]
      if (Array.isArray(response)) {
        // Tool calls come in format: [{ name: string, arguments: object }]
        // We need to convert to our internal format: [{ tool_name: string, parameter: object }]
        return response.map((item: any) => ({
          parameter: item.arguments || item.parameter,
          tool_name: item.name || item.tool_name,
        })) as SupervisorToolCall[];
      }

      // If response is a string, try to parse it as JSON
      if (typeof response === 'string') {
        try {
          const parsed = JSON.parse(response);
          if (Array.isArray(parsed)) {
            return parsed.map((item: any) => ({
              parameter: item.arguments || item.parameter,
              tool_name: item.name || item.tool_name,
            })) as SupervisorToolCall[];
          }
        } catch {
          // Fall back to string response for legacy parsing
          return response;
        }
      }

      // For any other response format, fall back to string
      return typeof response === 'object' ? JSON.stringify(response) : String(response);
    } catch (err) {
      if (this.isAbortError(err, context)) {
        throw this.createAbortError();
      }

      console.error('Supervisor LLM error:', err);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private createAbortError() {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    return abortError;
  }

  private isAbortError(error: unknown, context: SupervisorContext) {
    if (context.abortController?.signal.aborted) return true;

    const name = (error as DOMException)?.name;

    return name === 'AbortError';
  }

  private parseSupervisorResponse(
    response: SupervisorToolCall[] | string,
    availableAgents: GroupMemberWithAgent[],
    context: SupervisorContext,
  ): SupervisorDecisionResult {
    const previousTodos = (context.todoList || []).map((item) => ({ ...item }));
    let primaryError: unknown = null;

    try {
      const toolCalls = this.normalizeToolCalls(response);
      return this.processToolCalls(toolCalls, previousTodos, availableAgents, context);
    } catch (error) {
      primaryError = error;
    }

    try {
      const todos = this.extractLegacyTodoList(response, previousTodos);
      const decisions = this.parseLegacyDecisions(response, availableAgents);
      return { decisions, todoUpdated: false, todos };
    } catch (legacyError) {
      const primaryMessage =
        primaryError instanceof Error && primaryError.message === '__LEGACY_FORMAT__'
          ? 'legacy format detected'
          : primaryError instanceof Error
            ? primaryError.message
            : String(primaryError);
      const legacyMessage =
        legacyError instanceof Error ? legacyError.message : String(legacyError);

      throw new Error(`Failed to parse supervisor response: ${primaryMessage} | ${legacyMessage}`);
    }
  }

  private normalizeToolCalls(response: SupervisorToolCall[] | string): SupervisorToolCall[] {
    // Tool calls are strictly formatted, so we can simplify
    if (Array.isArray(response)) {
      return response
        .filter((item) => item && typeof item === 'object' && item.tool_name)
        .map((item) => ({
          parameter: item.parameter,
          tool_name: item.tool_name as SupervisorToolName,
        }));
    }

    if (typeof response === 'string') {
      const parsed = this.tryParseJson(response);

      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => item && typeof item === 'object' && item.tool_name)
          .map((item) => ({
            parameter: item.parameter,
            tool_name: item.tool_name as SupervisorToolName,
          }));
      }

      // Check for legacy format
      if (parsed && typeof parsed === 'object' && ('decisions' in parsed || 'todos' in parsed)) {
        throw new Error('__LEGACY_FORMAT__');
      }

      throw new Error('No tool calls array found in response');
    }

    throw new Error('Unsupported supervisor response format');
  }

  private processToolCalls(
    toolCalls: SupervisorToolCall[],
    previousTodos: SupervisorTodoItem[],
    availableAgents: GroupMemberWithAgent[],
    context: SupervisorContext,
  ): SupervisorDecisionResult {
    if (toolCalls.length === 0) {
      return { decisions: [], todoUpdated: false, todos: previousTodos };
    }

    const todos = previousTodos.map((todo) => ({ ...todo }));
    const decisions: SupervisorDecisionList = [];
    let todoUpdated = false;

    toolCalls.forEach((call) => {
      switch (call.tool_name) {
        case 'create_todo': {
          if (context.scene === 'productive') {
            const changed = this.applyCreateTodo(todos, call.parameter);
            if (changed) todoUpdated = true;
          }
          break;
        }
        case 'finish_todo': {
          if (context.scene === 'productive') {
            const changed = this.applyFinishTodo(todos, call.parameter);
            if (changed) todoUpdated = true;
          }
          break;
        }
        case 'wait_for_user_input': {
          // Pause conversation - no action needed, just don't add any decisions
          console.log('DEBUG: Supervisor paused conversation:', call.parameter);
          break;
        }
        case 'trigger_agent':
        case 'trigger_agent_dm': {
          const decision = this.buildDecisionFromTool(call.parameter, availableAgents, context);
          console.log('DEBUG: Built decision from tool:', {
            decision,
            parameter: call.parameter,
            toolName: call.tool_name,
          });
          if (decision) {
            decisions.push(decision);
          }
          break;
        }
      }
    });

    console.log('DEBUG: Final decisions:', decisions);

    return { decisions, todoUpdated, todos };
  }

  private applyCreateTodo(targetTodos: SupervisorTodoItem[], parameter: unknown): boolean {
    if (!parameter || typeof parameter !== 'object') return false;

    const payload = parameter as Record<string, unknown>;

    // New format: { todos: [...] }
    if (Array.isArray(payload.todos)) {
      let hasChanged = false;

      for (const todoItem of payload.todos) {
        const { content, assignee } = this.extractTodoData(todoItem);
        if (!content) continue;

        const exists = targetTodos.some(
          (todo) => todo.content.trim().toLowerCase() === content.toLowerCase() && !todo.finished,
        );

        if (exists) continue;

        const newTodo: SupervisorTodoItem = { content, finished: false };
        if (assignee && typeof assignee === 'string' && assignee.trim()) {
          newTodo.assignee = assignee.trim();
        }
        targetTodos.push(newTodo);
        hasChanged = true;
      }

      return hasChanged;
    }

    // Legacy format: direct todo object (for backward compatibility)
    const { content, assignee } = this.extractTodoData(parameter);
    if (!content) return false;

    const exists = targetTodos.some(
      (todo) => todo.content.trim().toLowerCase() === content.toLowerCase() && !todo.finished,
    );

    if (exists) return false;

    const newTodo: SupervisorTodoItem = { content, finished: false };
    if (assignee && typeof assignee === 'string' && assignee.trim()) {
      newTodo.assignee = assignee.trim();
    }
    targetTodos.push(newTodo);
    return true;
  }

  private extractTodoData(parameter: unknown): { assignee?: string; content: string | null } {
    if (typeof parameter === 'string') {
      const trimmed = parameter.trim();
      return { content: trimmed ? trimmed : null };
    }

    if (!parameter || typeof parameter !== 'object') return { content: null };

    const payload = parameter as Record<string, unknown>;

    // Since we constrained the schema to require 'content', prioritize it
    // But keep fallbacks for backward compatibility with existing data
    const candidates: unknown[] = [
      payload.content, // Primary field from schema
      payload.id, // Fallback for current format
      payload.title,
      payload.task,
      payload.text,
      payload.message,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return { assignee: this.extractAssignee(payload), content: candidate.trim() };
      }
    }

    return { content: null };
  }

  private extractAssignee(payload: Record<string, unknown>): string | undefined {
    const a = payload.assignee;
    if (typeof a === 'string' && a.trim()) return a.trim();
    return undefined;
  }

  private applyFinishTodo(targetTodos: SupervisorTodoItem[], parameter: unknown): boolean {
    if (!parameter || typeof parameter !== 'object') return false;

    const payload = parameter as Record<string, unknown>;

    // Since we constrained the schema to require 'index', we expect it to be present
    if (typeof payload.index === 'number') {
      return this.finishTodoByIndex(targetTodos, payload.index);
    }

    return false;
  }

  private finishTodoByIndex(targetTodos: SupervisorTodoItem[], index: number): boolean {
    if (!Number.isInteger(index)) return false;
    if (index < 0 || index >= targetTodos.length) return false;
    if (targetTodos[index].finished) return false;
    targetTodos[index].finished = true;
    return true;
  }

  private buildDecisionFromTool(
    parameter: unknown,
    availableAgents: GroupMemberWithAgent[],
    context: SupervisorContext,
  ): SupervisorDecision | null {
    if (typeof parameter === 'string') {
      return this.createDecisionFromPayload({ id: parameter }, availableAgents, context);
    }

    if (!parameter || typeof parameter !== 'object') return null;

    return this.createDecisionFromPayload(
      parameter as Record<string, unknown>,
      availableAgents,
      context,
    );
  }

  private createDecisionFromPayload(
    payload: Record<string, unknown>,
    availableAgents: GroupMemberWithAgent[],
    context: SupervisorContext,
  ): SupervisorDecision | null {
    const idValue =
      typeof payload.id === 'string'
        ? payload.id
        : typeof payload.agentId === 'string'
          ? payload.agentId
          : typeof payload.speaker === 'string'
            ? payload.speaker
            : undefined;
    if (!idValue) return null;

    const agentExists = availableAgents.some((agent) => agent.id === idValue);
    if (!agentExists) return null;

    const instruction =
      typeof payload.instruction === 'string'
        ? payload.instruction
        : typeof payload.message === 'string'
          ? payload.message
          : undefined;

    const potentialTargets = [payload.target, payload.recipient, payload.to];
    let target: string | undefined;
    for (const candidate of potentialTargets) {
      if (typeof candidate === 'string') {
        target = candidate;
        break;
      }
    }

    if (target && target !== 'user') {
      const targetExists = availableAgents.some((agent) => agent.id === target);
      if (!targetExists) target = undefined;
    }

    if (context.allowDM === false && target === 'user') {
      target = undefined;
    }

    return {
      id: idValue,
      instruction,
      target: target || undefined,
    };
  }

  private parseLegacyDecisions(
    response: SupervisorToolCall[] | string,
    availableAgents: GroupMemberWithAgent[],
  ): SupervisorDecisionList {
    try {
      const decisions = this.normalizeLegacyDecisions(response);

      if (!Array.isArray(decisions)) {
        throw new Error('Response must include a decisions array');
      }

      if (decisions.length === 0) {
        return [];
      }

      return decisions
        .filter(
          (item: any) =>
            typeof item === 'object' &&
            item !== null &&
            typeof item.id === 'string' &&
            availableAgents.some((agent) => agent.id === item.id),
        )
        .map((item: any) => ({
          id: item.id,
          instruction: typeof item.instruction === 'string' ? item.instruction : undefined,
          target: typeof item.target === 'string' ? item.target : undefined,
        }));
    } catch (error) {
      throw new Error(
        `Failed to parse supervisor decision: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private normalizeLegacyDecisions(response: SupervisorToolCall[] | string) {
    if (typeof response === 'string') {
      const parsed = this.extractJsonObjectFromString(response);

      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray((parsed as any).decisions)) return (parsed as any).decisions;

      const decisionsArray = this.extractJsonArrayFromString(response);
      if (!Array.isArray(decisionsArray)) {
        throw new Error('No JSON array found in response');
      }

      return decisionsArray;
    }

    if (response && typeof response === 'object' && !Array.isArray(response)) {
      const decisions = (response as { decisions?: unknown }).decisions;
      if (Array.isArray(decisions)) return decisions;
    }

    return null;
  }

  private extractLegacyTodoList(
    response: SupervisorToolCall[] | string,
    previousTodos: SupervisorTodoItem[],
  ): SupervisorTodoItem[] {
    const normalize = (items: unknown): SupervisorTodoItem[] | undefined => {
      if (items === undefined) return undefined;
      if (!Array.isArray(items)) return [];

      return items
        .filter(
          (item): item is SupervisorTodoItem =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as any).content === 'string' &&
            typeof (item as any).finished === 'boolean',
        )
        .map((item: any) => ({
          assignee:
            typeof (item as any).assignee === 'string' && (item as any).assignee.trim()
              ? ((item as any).assignee as string).trim()
              : undefined,
          content: (item as SupervisorTodoItem).content,
          finished: (item as SupervisorTodoItem).finished,
        }));
    };

    if (typeof response === 'string') {
      const parsed = this.extractJsonObjectFromString(response);
      if (parsed) {
        const normalized = normalize((parsed as { todos?: unknown }).todos);
        if (normalized !== undefined) return normalized;
      }

      return previousTodos;
    }

    if (response && typeof response === 'object' && !Array.isArray(response)) {
      const normalized = normalize((response as { todos?: unknown }).todos);
      if (normalized !== undefined) return normalized;
    }

    return previousTodos;
  }

  private tryParseJson(value: string): unknown {
    if (!value) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = undefined;
    }

    if (parsed !== undefined) return parsed;

    const objectResult = this.extractJsonObjectFromString(value);
    if (objectResult !== null) return objectResult;

    return this.extractJsonArrayFromString(value) ?? undefined;
  }

  private extractJsonObjectFromString(response: string) {
    const trimmed = response.trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = undefined;
    }

    if (parsed && typeof parsed === 'object') {
      return parsed;
    }

    const startIndex = response.indexOf('{');
    const endIndex = response.lastIndexOf('}');

    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      return null;
    }

    const jsonText = response.slice(startIndex, endIndex + 1);

    try {
      return JSON.parse(jsonText);
    } catch {
      return null;
    }
  }

  private extractJsonArrayFromString(response: string) {
    const startIndex = response.indexOf('[');
    const endIndex = response.lastIndexOf(']');
    if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
      return null;
    }

    const jsonText = response.slice(startIndex, endIndex + 1);
    try {
      return JSON.parse(jsonText);
    } catch (error) {
      console.error('Failed to parse JSON array from supervisor response:', error);
      return null;
    }
  }

  /**
   * Quick validation of decision against group rules
   */
  validateDecision(decisions: SupervisorDecisionList, context: SupervisorContext): boolean {
    const { availableAgents } = context;

    // Empty array is always valid (means stop)
    if (decisions.length === 0) return true;

    return decisions.every((decision) => {
      // Validate speaker exists
      const speakerExists = availableAgents.some((agent) => agent.id === decision.id);
      if (!speakerExists) return false;

      // Validate target exists if specified
      if (decision.target) {
        return (
          decision.target === 'user' ||
          availableAgents.some((agent) => agent.id === decision.target)
        );
      }

      return true;
    });
  }
}
