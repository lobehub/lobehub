import type { AgentSignalSource, BaseAction, BaseSignal } from '@lobechat/agent-signal';

import {
  AgentSignalScheduler,
  type AgentSignalSchedulerHandler,
  type AgentSignalSchedulerRegistry,
  type AgentSignalSourceInput,
} from './AgentSignalScheduler';
import type {
  AgentSignalRuntimeBackend,
  RuntimeNextHop,
  RuntimePendingClaim,
  RuntimeWaypoint,
} from './backend/types';
import type { AgentSignalRuntimeConfig, ResolveAgentSignalRuntimeConfigOptions } from './config';
import { resolveAgentSignalRuntimeConfig } from './config';
import type { RuntimeBackend as ContextRuntimeBackend, RuntimeNode } from './context';
import type { AgentSignalMiddleware, AgentSignalMiddlewareRegistries } from './middleware';
import { createAgentSignalMiddlewareInstallContext } from './middleware';

export type AgentSignalRuntimeHandler<TNode extends RuntimeNode = RuntimeNode> =
  AgentSignalSchedulerHandler<TNode>;
export type AgentSignalRuntimeRegistry<TNode extends RuntimeNode = RuntimeNode> =
  AgentSignalSchedulerRegistry<TNode>;

export interface RuntimeGuardState {
  lastEventAt?: number;
  startedAt?: number;
}

interface RuntimeWaypointState extends RuntimeWaypoint {
  trigger?: RuntimeNode;
}

export interface RuntimeGuardBackend {
  getGuardState: ContextRuntimeBackend['getGuardState'];
  touchGuardState: ContextRuntimeBackend['touchGuardState'];
}

export interface AgentSignalRuntimeRegistries {
  actionRegistry: AgentSignalSchedulerRegistry<BaseAction>;
  signalRegistry: AgentSignalSchedulerRegistry<BaseSignal>;
  sourceRegistry: AgentSignalSchedulerRegistry<AgentSignalSource>;
}

const createRuntimeRegistry = <
  TNode extends RuntimeNode,
>(): AgentSignalSchedulerRegistry<TNode> => {
  const entries = new Map<string, Array<AgentSignalSchedulerHandler<TNode>>>();

  return {
    match(type) {
      return [...(entries.get(type) ?? [])];
    },
    register(type, entry) {
      const current = entries.get(type) ?? [];
      current.push(entry);
      entries.set(type, current);

      return this;
    },
  };
};

const resolveRuntimeTrigger = (waypoint: RuntimeWaypointState): RuntimeNode | undefined => {
  if (waypoint.pending) {
    return waypoint.pending.source;
  }

  if (!waypoint.terminal) {
    return waypoint.events[0];
  }

  const terminalIndex = waypoint.events.findIndex(
    (event) => event.sourceId === waypoint.terminal?.sourceId,
  );

  if (terminalIndex === -1) {
    return waypoint.events[0];
  }

  return waypoint.events[terminalIndex + 1];
};

const createEmptyRuntimeWaypoint = (scopeKey: string): RuntimeWaypointState => {
  return {
    events: [],
    scopeKey,
  };
};

const createInMemoryRuntimeGuardBackend = (): RuntimeGuardBackend => {
  const guardState = new Map<string, RuntimeGuardState>();

  return {
    async getGuardState(scopeKey, lane) {
      return guardState.get(`${scopeKey}:${lane}`) ?? {};
    },
    async touchGuardState(scopeKey, lane, now) {
      const key = `${scopeKey}:${lane}`;
      const current = guardState.get(key) ?? {};
      const next = {
        lastEventAt: now,
        startedAt: current.startedAt ?? now,
      } satisfies RuntimeGuardState;

      guardState.set(key, next);

      return next;
    },
  };
};

const createInMemoryDurableBackend = (): AgentSignalRuntimeBackend => {
  const waypoints = new Map<string, RuntimeWaypointState>();

  const readWaypoint = (scopeKey: string) => {
    return waypoints.get(scopeKey) ?? createEmptyRuntimeWaypoint(scopeKey);
  };

  const writeWaypoint = (scopeKey: string, next: RuntimeWaypointState) => {
    waypoints.set(scopeKey, next);
  };

  const findNextPendingSource = (waypoint: RuntimeWaypointState) => {
    if (waypoint.pending) {
      return waypoint.pending.source;
    }

    if (!waypoint.terminal) {
      return waypoint.events[0];
    }

    const terminalIndex = waypoint.events.findIndex(
      (event) => event.sourceId === waypoint.terminal?.sourceId,
    );

    if (terminalIndex === -1) {
      return waypoint.events[0];
    }

    return waypoint.events[terminalIndex + 1];
  };

  return {
    async appendToWaypoint(scopeKey, source) {
      const current = readWaypoint(scopeKey);

      writeWaypoint(scopeKey, {
        ...current,
        events: [...current.events, source],
      });
    },
    async claimPending(scopeKey) {
      const current = readWaypoint(scopeKey);
      if (current.pending) {
        return current.pending;
      }

      const source = findNextPendingSource(current);
      if (!source) return null;

      const pending: RuntimePendingClaim = {
        scopeKey,
        source,
        status: 'pending',
      };

      writeWaypoint(scopeKey, {
        ...current,
        pending,
      });

      return pending;
    },
    async complete(input) {
      const current = readWaypoint(input.scopeKey);
      if (current.pending?.source.sourceId !== input.sourceId) {
        return;
      }

      writeWaypoint(input.scopeKey, {
        ...current,
        pending: undefined,
        terminal: {
          completedAt: input.completedAt,
          sourceId: input.sourceId,
          status: 'completed',
        },
      });
    },
    async fail(input) {
      const current = readWaypoint(input.scopeKey);
      if (current.pending?.source.sourceId !== input.sourceId) {
        return;
      }

      writeWaypoint(input.scopeKey, {
        ...current,
        pending: undefined,
        terminal: {
          error: input.error,
          failedAt: input.failedAt,
          sourceId: input.sourceId,
          status: 'failed',
        },
      });
    },
    async loadWaypoint(scopeKey) {
      return readWaypoint(scopeKey);
    },
    async scheduleNextHop(input: RuntimeNextHop) {
      const current = readWaypoint(input.scopeKey);

      writeWaypoint(input.scopeKey, {
        ...current,
        nextHop: input,
      });
    },
  };
};

const createRuntimeHostBackend = (input: {
  durableBackend: Pick<AgentSignalRuntimeBackend, 'appendToWaypoint' | 'loadWaypoint'>;
  guardBackend?: RuntimeGuardBackend;
}): ContextRuntimeBackend => {
  const guardBackend = input.guardBackend ?? createInMemoryRuntimeGuardBackend();

  return {
    appendToWaypoint(scopeKey, source) {
      return input.durableBackend.appendToWaypoint(scopeKey, source);
    },
    async getGuardState(scopeKey, lane) {
      return guardBackend.getGuardState(scopeKey, lane);
    },
    async loadWaypoint(scopeKey) {
      const waypoint = await input.durableBackend.loadWaypoint(scopeKey);

      return {
        trigger: resolveRuntimeTrigger(waypoint),
      };
    },
    touchGuardState(scopeKey, lane, now) {
      return guardBackend.touchGuardState(scopeKey, lane, now);
    },
  };
};

const createConfiguredDurableBackend = (
  options: CreateAgentSignalRuntimeOptions,
): {
  durableBackend: AgentSignalRuntimeBackend;
  runtimeConfig: AgentSignalRuntimeConfig;
} => {
  const runtimeConfig =
    options.runtimeConfig ??
    resolveAgentSignalRuntimeConfig(
      options.runtimeConfigInput ?? {
        enableAgentSignalRuntime: true,
        enableDurableRuntime: false,
      },
    );

  return {
    durableBackend: options.durableBackend ?? createInMemoryDurableBackend(),
    runtimeConfig,
  };
};

export interface CreateAgentSignalRuntimeOptions {
  backend?: ContextRuntimeBackend;
  durableBackend?: AgentSignalRuntimeBackend;
  guardBackend?: RuntimeGuardBackend;
  policies?: AgentSignalMiddleware[];
  runtimeConfig?: AgentSignalRuntimeConfig;
  runtimeConfigInput?: ResolveAgentSignalRuntimeConfigOptions;
}

/**
 * Default assembled runtime for Agent Signal.
 *
 * Call stack:
 *
 * createAgentSignalRuntime
 *   -> {@link resolveAgentSignalRuntimeConfig}
 *   -> AgentSignalMiddleware.install
 *   -> {@link AgentSignalScheduler}
 */
export class AgentSignalRuntime {
  readonly actionRegistry: AgentSignalSchedulerRegistry<BaseAction>;
  readonly backend: ContextRuntimeBackend;
  readonly durableBackend: AgentSignalRuntimeBackend;
  readonly runtimeConfig: AgentSignalRuntimeConfig;
  readonly scheduler: AgentSignalScheduler;
  readonly signalRegistry: AgentSignalSchedulerRegistry<BaseSignal>;
  readonly sourceRegistry: AgentSignalSchedulerRegistry<AgentSignalSource>;

  constructor(options: Omit<CreateAgentSignalRuntimeOptions, 'policies'> = {}) {
    this.actionRegistry = createRuntimeRegistry<BaseAction>();
    this.signalRegistry = createRuntimeRegistry<BaseSignal>();
    this.sourceRegistry = createRuntimeRegistry<AgentSignalSource>();

    const { durableBackend, runtimeConfig } = createConfiguredDurableBackend(options);
    this.durableBackend = durableBackend;
    this.runtimeConfig = runtimeConfig;
    this.backend =
      options.backend ??
      createRuntimeHostBackend({
        durableBackend,
        guardBackend: options.guardBackend,
      });

    this.scheduler = new AgentSignalScheduler({
      actionRegistry: this.actionRegistry,
      backend: this.backend,
      signalRegistry: this.signalRegistry,
      sourceRegistry: this.sourceRegistry,
    });
  }

  async installPolicies(policies: AgentSignalMiddleware[] = []) {
    const context = createAgentSignalMiddlewareInstallContext(
      this.getRegistries() satisfies AgentSignalMiddlewareRegistries,
    );

    for (const policy of policies) {
      await policy.install(context);
    }

    return this;
  }

  getRegistries(): AgentSignalRuntimeRegistries {
    return {
      actionRegistry: this.actionRegistry,
      signalRegistry: this.signalRegistry,
      sourceRegistry: this.sourceRegistry,
    };
  }

  emit(input: AgentSignalSourceInput) {
    return this.scheduler.emit(input);
  }

  emitNormalized(source: AgentSignalSource) {
    return this.scheduler.emitNormalized(source);
  }
}

export const createAgentSignalRuntime = async (options: CreateAgentSignalRuntimeOptions = {}) => {
  const runtime = new AgentSignalRuntime(options);

  await runtime.installPolicies(options.policies);

  return runtime;
};
