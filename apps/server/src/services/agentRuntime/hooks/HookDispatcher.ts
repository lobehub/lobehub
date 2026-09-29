import type { ToolCallPreparation, ToolRunResult } from '@lobechat/agent-runtime';
import type { SerializedAgentHook } from '@lobechat/types';
import {
  agentHookMatcherSchema,
  agentHookTypeSchema,
  resolveToolCallHookErrorPolicy,
  serializedAgentHookSchema,
} from '@lobechat/types';
import debug from 'debug';

import { isQueueAgentRuntimeEnabled } from '@/server/services/queue/impls';

import type { HookDeliveryContext } from './deliveryContext';
import { deliverWebhook, executeToolCallWebhook } from './httpWebhook';
import { matchesHook } from './matcher';
import type {
  AgentHook,
  AgentHookEvent,
  AgentHookType,
  AnyHookEvent,
  SerializedHook,
  ToolCallControlEvent,
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

/** Validate persisted configurations on every worker restore. */
export function parseSerializedHooks(hooks: SerializedAgentHook[]): SerializedHook[] {
  return hooks.map((hook) => serializedAgentHookSchema.parse(hook));
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

  /** Continuations retain local callbacks when present and validated durable webhooks otherwise. */
  getContinuationHooks(operationId: string, serializedHooks?: SerializedAgentHook[]): AgentHook[] {
    // The schema's cross-field refinements enforce AgentHook's discriminated
    // control/notification union; Zod's inferred object type cannot express it.
    return (
      this.hooks.get(operationId) ?? (parseSerializedHooks(serializedHooks ?? []) as AgentHook[])
    );
  }
  /**
   * In-memory hook store (local mode)
   * Maps operationId → AgentHook[]
   */
  private hooks: Map<string, AgentHook[]> = new Map();

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
    /** Trusted runtime owner for this call; not persisted with hook configuration. */
    deliveryContext?: HookDeliveryContext,
  ): Promise<void> {
    return this.dispatchHooks(
      operationId,
      type,
      event,
      serializedHooks,
      undefined,
      deliveryContext,
    );
  }

  private async dispatchHooks(
    operationId: string,
    type: AgentHookType,
    event: AnyHookEvent,
    serializedHooks?: SerializedAgentHook[],
    stopAfterHandler?: () => boolean,
    deliveryContext?: HookDeliveryContext,
  ): Promise<void> {
    const isQueueMode = isQueueAgentRuntimeEnabled();
    const restored = serializedHooks ? parseSerializedHooks(serializedHooks) : undefined;

    const registered = this.hooks.get(operationId);
    const hooks: (AgentHook | SerializedHook)[] = isQueueMode
      ? (restored ?? this.getSerializedHooks(operationId) ?? [])
      : (registered ?? restored ?? []);
    let criticalError: CriticalHookDeliveryError | undefined;
    for (const hook of hooks.filter(
      (h) =>
        h.type === type &&
        h.webhook?.responseHandling !== 'toolCall' &&
        matchesHook(h.matcher, event),
    )) {
      const handler = 'handler' in hook ? hook.handler : undefined;
      const useHandler = !isQueueMode && !!handler;
      // Preserve first-mock handler semantics without dropping independent HTTP callbacks.
      if (useHandler && stopAfterHandler?.()) continue;
      try {
        if (useHandler) {
          await handler(event as AgentHookEvent);
        } else if (hook.webhook) {
          const payload = await this.buildWebhookPayload(
            event,
            hook.webhook,
            { hookId: hook.id, hookType: type },
            { deliveryContext },
          );
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

  /** Ordered synchronous controls. Cancellation never goes through onError. */
  async prepareToolCall(
    operationId: string,
    event: ToolCallControlEvent,
    serializedHooks?: SerializedAgentHook[],
    signal?: AbortSignal,
    checkCancellation?: () => Promise<boolean>,
  ): Promise<ToolCallPreparation> {
    const originalArgs = structuredClone(event.originalArgs);
    const ready: ToolCallPreparation = {
      originalArgs,
      additionalContexts: [],
      status: 'ready',
    };
    const restored = serializedHooks ? parseSerializedHooks(serializedHooks) : undefined;
    const hooks = isQueueAgentRuntimeEnabled()
      ? (restored ?? this.getSerializedHooks(operationId) ?? [])
      : (this.hooks.get(operationId) ?? restored ?? []);
    for (const hook of hooks) {
      if (signal?.aborted) return { originalArgs, status: 'cancelled' };
      if (
        hook.type !== 'beforeToolCall' ||
        hook.webhook?.responseHandling !== 'toolCall' ||
        !matchesHook(hook.matcher, event)
      )
        continue;
      if (await checkCancellation?.()) return { originalArgs, status: 'cancelled' };
      const payload = await this.buildWebhookPayload(
        {
          ...event,
          args: structuredClone(ready.effectiveArgs ?? originalArgs),
          originalArgs: structuredClone(originalArgs),
        },
        {},
        { hookId: hook.id, hookType: 'beforeToolCall' },
        { signal },
      );
      if (!payload || signal?.aborted || (await checkCancellation?.()))
        return { originalArgs, status: 'cancelled' };
      const response = await executeToolCallWebhook(hook.webhook, payload, { signal });
      if (signal?.aborted || response.status === 'cancelled' || (await checkCancellation?.()))
        return { originalArgs, status: 'cancelled' };
      if (response.status === 'error') {
        if (resolveToolCallHookErrorPolicy(hook.webhook.onError).action === 'block') {
          return {
            ...ready,
            status: 'blocked',
            reason: 'hook_control_error',
          };
        }
        continue;
      }
      if (response.decision?.additionalContext !== undefined) {
        ready.additionalContexts = ready.additionalContexts!.filter(
          ({ hookId }) => hookId !== hook.id,
        );
        ready.additionalContexts.push({
          hookId: hook.id,
          text: response.decision.additionalContext,
        });
      }
      if (response.decision?.permissionDecision === 'deny') {
        return {
          ...ready,
          status: 'blocked',
          reason: response.decision.permissionDecisionReason ?? 'Blocked by beforeToolCall hook.',
        };
      }
      if (response.decision?.permissionDecision === 'allow' && response.decision.updatedInput) {
        ready.effectiveArgs = structuredClone(response.decision.updatedInput);
      }
    }
    return signal?.aborted ? { originalArgs, status: 'cancelled' } : ready;
  }

  /** Deliver each observation once; only local handlers can supply a mock. */
  async dispatchBeforeToolCall(
    operationId: string,
    event: Omit<ToolCallHookEvent, 'mock' | 'operationId'>,
    serializedHooks?: SerializedAgentHook[],
    deliveryContext?: HookDeliveryContext,
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
    await this.dispatchHooks(
      operationId,
      'beforeToolCall',
      toolCallEvent,
      serializedHooks,
      () => !!mockedResult,
      deliveryContext,
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
    const hooks = this.hooks.get(operationId)?.filter((hook) => hook.type === type) ?? [];

    return isQueueAgentRuntimeEnabled() ? hooks.some((hook) => hook.webhook) : hooks.length > 0;
  }

  /**
   * Register hooks for an operation
   *
   * In local mode: stores hooks in memory (including handler functions)
   * In production mode: caller should persist getSerializedHooks() to state.host.hooks
   */
  register(operationId: string, hooks: AgentHook[]): void {
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
    const existing = this.hooks.get(operationId) || [];
    this.hooks.set(operationId, [...existing, ...validatedHooks]);

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
