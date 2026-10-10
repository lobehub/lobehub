import type { ToolRunResult } from '@lobechat/agent-runtime';
import type { SerializedAgentHook } from '@lobechat/types';
import {
  agentHookMatcherSchema,
  agentHookTypeSchema,
  resolveToolCallHookErrorPolicy,
  serializedAgentHookSchema,
} from '@lobechat/types';
import debug from 'debug';

import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import { deliverWebhook, executeToolCallWebhook } from './httpWebhook';
import { matchesHook } from './matcher';
import { getServerHooks, mergeServerHooks } from './serverHooks';
import type {
  AfterToolCallHookEvent,
  AgentHook,
  AgentHookEvent,
  AgentHookType,
  AnyHookEvent,
  SerializedHook,
  ToolCallHookEvent,
} from './types';
import { createWebhookPayloadBuilder } from './webhookPayload';

const log = debug('lobe-server:hook-dispatcher');

export class CriticalHookDeliveryError extends Error {
  constructor(
    public readonly hookId: string,
    public readonly cause: unknown,
  ) {
    super(`Critical webhook delivery failed: ${hookId}`, { cause });
    this.name = 'CriticalHookDeliveryError';
  }
}

export { deliverWebhook } from './httpWebhook';

/** Discard legacy environment hooks and validate caller configs on every worker restore. */
export function parseSerializedHooks(hooks: SerializedAgentHook[]): SerializedHook[] {
  return mergeServerHooks(hooks, []).map((hook) => serializedAgentHookSchema.parse(hook));
}

/**
 * HookDispatcher — central hub for registering and dispatching agent lifecycle hooks
 *
 * Local mode: hooks are stored in memory, handler functions called directly
 * Production mode: webhook configs persisted in AgentState.host.hooks,
 *   delivered via HTTP POST or QStash
 */
export class HookDispatcher {
  private readonly buildWebhookPayload = createWebhookPayloadBuilder();

  /**
   * In-memory hook store (local mode)
   * Maps operationId → AgentHook[]
   */
  private hooks: Map<string, AgentHook[]> = new Map();

  /** Shared by normal dispatch and tool control, including cold-worker recovery. */
  private resolveHooks(
    operationId: string,
    serializedHooks?: SerializedAgentHook[],
    includeServerHooks = true,
  ) {
    const restored = serializedHooks ? parseSerializedHooks(serializedHooks) : undefined;
    const hooks: (AgentHook | SerializedHook)[] = isQueueAgentRuntimeEnabled()
      ? (restored ?? this.getSerializedHooks(operationId) ?? [])
      : (this.hooks.get(operationId) ?? restored ?? []);
    return mergeServerHooks(hooks, includeServerHooks ? getServerHooks() : []);
  }

  /**
   * Dispatch hooks for a given event type
   *
   * In local mode: calls handler functions from memory
   * In production mode: delivers webhooks from serialized config
   */
  async dispatch(
    operationId: string,
    type: AgentHookType,
    event: AnyHookEvent,
    /**
     * Hooks persisted on `state.host.hooks` (wire shape). Narrowed here to the
     * runtime-precise {@link SerializedHook} once the type / webhook are checked.
     */
    serializedHooks?: SerializedAgentHook[],
  ): Promise<void> {
    return this.dispatchHooks(operationId, type, event, serializedHooks);
  }

  private async dispatchHooks(
    operationId: string,
    type: AgentHookType,
    event: AnyHookEvent,
    serializedHooks?: SerializedAgentHook[],
    stopAfterHandler?: () => boolean,
    consumer?: 'handler' | 'webhook',
  ): Promise<void> {
    const isQueueMode = isQueueAgentRuntimeEnabled();
    const hooks = this.resolveHooks(operationId, serializedHooks);
    let criticalError: CriticalHookDeliveryError | undefined;
    for (const hook of hooks.filter(
      (h) =>
        h.type === type &&
        h.webhook?.responseHandling !== 'toolCall' &&
        matchesHook(h.matcher, event),
    )) {
      const handler = 'handler' in hook ? hook.handler : undefined;
      const useHandler = !isQueueMode && !!handler;
      if (consumer === 'handler' && !useHandler) continue;
      if (consumer === 'webhook' && useHandler) continue;
      // Preserve first-mock handler semantics without dropping independent HTTP callbacks.
      if (useHandler && stopAfterHandler?.()) continue;
      try {
        if (useHandler) {
          await handler(event as AgentHookEvent);
        } else if (hook.webhook) {
          const payload = await this.buildWebhookPayload(event, hook.webhook, {
            hookId: hook.id,
            hookType: type,
          });
          if (payload) {
            delete payload.mock;
            await deliverWebhook(hook.webhook, payload);
          }
        }
      } catch (error) {
        if (!useHandler && hook.webhook?.fallback === 'none') {
          console.error(
            '[HookDispatcher] Critical webhook delivery failed',
            { operationId, hookId: hook.id, hookType: type },
            error,
          );
          criticalError ??= new CriticalHookDeliveryError(hook.id, error);
        } else if (!useHandler) {
          console.error(
            '[HookDispatcher] Webhook delivery failed (non-fatal)',
            { operationId, hookId: hook.id, hookType: type },
            error,
          );
        } else {
          log('[%s][%s] Hook failed (non-fatal): %s', operationId, type, hook.id);
        }
      }
    }
    // Independent critical callbacks all get a chance to run before surfacing the failure.
    if (criticalError) throw criticalError;
  }

  /** Includes cold-worker and current environment controls, without invoking a receiver. */
  hasAfterToolCallControl(
    operationId: string,
    serializedHooks?: SerializedAgentHook[],
    includeServerHooks = true,
  ): boolean {
    return this.resolveHooks(operationId, serializedHooks, includeServerHooks).some(
      (hook) => hook.type === 'afterToolCall' && hook.webhook?.responseHandling === 'toolCall',
    );
  }

  /** Ordered synchronous controls. Cancellation never goes through onError. */
  async evaluateToolCall(
    operationId: string,
    event: Omit<ToolCallHookEvent, 'mock'>,
    serializedHooks?: SerializedAgentHook[],
    signal?: AbortSignal,
  ): Promise<{ status: 'allow' | 'blocked' | 'cancelled'; reason?: string }> {
    return this.evaluateToolControl('beforeToolCall', operationId, event, serializedHooks, signal);
  }

  /** Result controls run before archival, persistence, streaming, and model consumption. */
  async evaluateAfterToolCall(
    operationId: string,
    event: AfterToolCallHookEvent,
    serializedHooks?: SerializedAgentHook[],
    signal?: AbortSignal,
    includeServerHooks = true,
  ): Promise<{ status: 'allow' | 'blocked' | 'cancelled'; reason?: string }> {
    return this.evaluateToolControl(
      'afterToolCall',
      operationId,
      event,
      serializedHooks,
      signal,
      includeServerHooks,
    );
  }

  private async evaluateToolControl(
    type: 'beforeToolCall' | 'afterToolCall',
    operationId: string,
    event: Omit<ToolCallHookEvent, 'mock'> | AfterToolCallHookEvent,
    serializedHooks?: SerializedAgentHook[],
    signal?: AbortSignal,
    includeServerHooks = true,
  ): Promise<{ status: 'allow' | 'blocked' | 'cancelled'; reason?: string }> {
    const hooks = this.resolveHooks(operationId, serializedHooks, includeServerHooks);
    for (const hook of hooks) {
      if (signal?.aborted) return { status: 'cancelled' };
      if (
        hook.type !== type ||
        hook.webhook?.responseHandling !== 'toolCall' ||
        !matchesHook(hook.matcher, event)
      )
        continue;
      const payload = await this.buildWebhookPayload(
        event,
        {},
        { hookId: hook.id, hookType: type },
        { preserveToolResult: true, signal },
      );
      if (!payload || signal?.aborted) return { status: 'cancelled' };
      const response = await executeToolCallWebhook(hook.webhook, payload, { signal });
      if (signal?.aborted || response.status === 'cancelled') return { status: 'cancelled' };
      // A notification response does not decide for any subsequent policy.
      if (response.status === 'ignored') continue;
      if (response.status === 'success' && response.decision.decision === 'deny') {
        return {
          status: 'blocked',
          reason: response.decision.reason || `Blocked by ${type} hook.`,
        };
      }
      if (response.status === 'error') {
        if (resolveToolCallHookErrorPolicy(hook.webhook.onError).action === 'block') {
          return {
            status: 'blocked',
            reason: 'hook_control_error',
          };
        }
        continue;
      }
    }
    return signal?.aborted ? { status: 'cancelled' } : { status: 'allow' };
  }

  /** Deliver each observation once; only local handlers can supply a mock. */
  async dispatchBeforeToolCall(
    operationId: string,
    event: Omit<ToolCallHookEvent, 'mock' | 'operationId'>,
    serializedHooks?: SerializedAgentHook[],
  ): Promise<{ isMocked: true; result: ToolRunResult } | null> {
    let mockedResult: ToolRunResult | undefined;
    const toolCallEvent: ToolCallHookEvent = {
      ...event,
      mock: (result) => {
        if (mockedResult) return false;
        mockedResult = result;
        return true;
      },
      operationId,
    };
    // Observations never become a tool-execution prerequisite. The normal
    // dispatcher retains critical failure reporting and independent siblings.
    void this.dispatchHooks(
      operationId,
      'beforeToolCall',
      toolCallEvent,
      serializedHooks,
      undefined,
      'webhook',
    ).catch((error: unknown) => {
      log('[%s][beforeToolCall] Observation delivery rejected: %O', operationId, error);
    });
    // Legacy local handlers can supply an asynchronous mock. Invoke them once;
    // the first mock stops only handlers, not the independent HTTP observation.
    await this.dispatchHooks(
      operationId,
      'beforeToolCall',
      toolCallEvent,
      serializedHooks,
      () => !!mockedResult,
      'handler',
    );
    return mockedResult ? { isMocked: true, result: mockedResult } : null;
  }

  /**
   * Get serialized hooks for an operation (for production mode persistence)
   */
  getSerializedHooks(operationId: string): SerializedHook[] | undefined {
    const hooks = this.hooks.get(operationId);
    if (!hooks) return undefined;

    return parseSerializedHooks(
      hooks
        .filter((h) => h.webhook)
        .map((h) => ({
          id: h.id,
          matcher: h.matcher,
          type: h.type,
          webhook: h.webhook!,
        })),
    );
  }

  /**
   * Check if any hooks are registered for an operation
   */
  hasHooks(operationId: string): boolean {
    return (this.hooks.get(operationId)?.length ?? 0) > 0;
  }

  hasHook(operationId: string, hookId: string): boolean {
    return this.hooks.get(operationId)?.some((hook) => hook.id === hookId) ?? false;
  }

  /**
   * Whether dispatching `type` right now would actually reach a consumer, under
   * the rules {@link dispatch} applies for the current runtime mode: local mode
   * needs a handler or webhook, queue mode needs a webhook to deliver.
   *
   * Callers that ALSO surface the same failure themselves (the IM bot bridge
   * reports a startup failure inline) ask this before deciding whether their own
   * report would be a duplicate — a failure the hooks will announce must not be
   * announced twice, and one they cannot announce must not vanish.
   */
  canDeliver(operationId: string, type: AgentHookType): boolean {
    const hooks = this.resolveHooks(operationId).filter((hook) => hook.type === type);

    return isQueueAgentRuntimeEnabled() ? hooks.some((hook) => hook.webhook) : hooks.length > 0;
  }

  /**
   * Register hooks for an operation
   *
   * In local mode: stores hooks in memory (including handler functions)
   * In production mode: caller should persist getSerializedHooks() to state.host.hooks
   */
  register(operationId: string, hooks: AgentHook[]): void {
    const existing = this.hooks.get(operationId) || [];
    hooks = mergeServerHooks([...existing, ...hooks], getServerHooks());
    if (hooks.length === 0) return;

    // Validate the entire batch before mutating registration state.
    const validatedHooks = hooks.map((hook) => {
      agentHookTypeSchema.parse(hook.type);
      if (typeof hook.id !== 'string') throw new Error('Hook id must be a string');
      if (hook.matcher !== undefined) {
        agentHookMatcherSchema.parse(hook.matcher);
        if (!['beforeToolCall', 'afterToolCall', 'onToolCallError'].includes(hook.type)) {
          throw new Error('Matchers are only supported for tool events');
        }
      }
      if (hook.handler !== undefined && typeof hook.handler !== 'function') {
        throw new Error('Hook handler must be a function');
      }
      if (hook.webhook) {
        const parsed = serializedAgentHookSchema.parse({
          id: hook.id,
          matcher: hook.matcher,
          type: hook.type,
          webhook: hook.webhook,
        });
        if (parsed.webhook.responseHandling === 'toolCall' && hook.handler)
          throw new Error('Control hooks cannot have a handler');
        return { ...parsed, handler: hook.handler } as AgentHook;
      } else if (!hook.handler) {
        throw new Error('A hook requires a handler or webhook');
      }
      return {
        ...hook,
        matcher:
          hook.matcher !== undefined ? agentHookMatcherSchema.parse(hook.matcher) : undefined,
      };
    });
    this.hooks.set(operationId, mergeServerHooks(validatedHooks, []));

    log(
      '[%s] Registered %d hooks: %s',
      operationId,
      hooks.length,
      hooks.map((h) => `${h.type}:${h.id}`).join(', '),
    );
  }

  /**
   * Unregister all hooks for an operation (cleanup)
   */
  unregister(operationId: string): void {
    this.hooks.delete(operationId);
    log('[%s] Unregistered all hooks', operationId);
  }
}

/**
 * Singleton instance — shared across the application
 */
export const hookDispatcher = new HookDispatcher();
