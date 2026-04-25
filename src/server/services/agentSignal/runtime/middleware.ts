import type { AgentSignalSource, BaseAction, BaseSignal } from '@lobechat/agent-signal';

import type {
  AgentSignalSchedulerHandler,
  AgentSignalSchedulerRegistry,
} from './AgentSignalScheduler';

export interface AgentSignalSourceHandlerDefinition {
  handler: AgentSignalSchedulerHandler<AgentSignalSource>;
  listen: string | string[];
  type: 'source';
}

export interface AgentSignalSignalHandlerDefinition {
  handler: AgentSignalSchedulerHandler<BaseSignal>;
  listen: string | string[];
  type: 'signal';
}

export interface AgentSignalActionHandlerDefinition {
  handler: AgentSignalSchedulerHandler<BaseAction>;
  listen: string | string[];
  type: 'action';
}

export type AgentSignalHandlerDefinition =
  | AgentSignalActionHandlerDefinition
  | AgentSignalSignalHandlerDefinition
  | AgentSignalSourceHandlerDefinition;

export interface AgentSignalMiddlewareInstallContext {
  handleAction: (handler: AgentSignalActionHandlerDefinition) => void;
  handleSignal: (handler: AgentSignalSignalHandlerDefinition) => void;
  handleSource: (handler: AgentSignalSourceHandlerDefinition) => void;
}

export interface AgentSignalMiddleware {
  install: (context: AgentSignalMiddlewareInstallContext) => Promise<void> | void;
}

export interface AgentSignalMiddlewareRegistries {
  actionRegistry: AgentSignalSchedulerRegistry<BaseAction>;
  signalRegistry: AgentSignalSchedulerRegistry<BaseSignal>;
  sourceRegistry: AgentSignalSchedulerRegistry<AgentSignalSource>;
}

const toListenArray = (listen: string | string[]) => {
  return Array.isArray(listen) ? listen : [listen];
};

export const defineSourceHandler = (
  listen: string | string[],
  handler: AgentSignalSchedulerHandler<AgentSignalSource>,
): AgentSignalSourceHandlerDefinition => {
  return {
    handler,
    listen,
    type: 'source',
  };
};

export const defineSignalHandler = (
  listen: string | string[],
  handler: AgentSignalSchedulerHandler<BaseSignal>,
): AgentSignalSignalHandlerDefinition => {
  return {
    handler,
    listen,
    type: 'signal',
  };
};

export const defineActionHandler = (
  listen: string | string[],
  handler: AgentSignalSchedulerHandler<BaseAction>,
): AgentSignalActionHandlerDefinition => {
  return {
    handler,
    listen,
    type: 'action',
  };
};

export const defineAgentSignalHandlers = (
  handlers: AgentSignalHandlerDefinition[],
): AgentSignalMiddleware => {
  return {
    install(context) {
      for (const handler of handlers) {
        if (handler.type === 'source') {
          context.handleSource(handler);
          continue;
        }

        if (handler.type === 'signal') {
          context.handleSignal(handler);
          continue;
        }

        context.handleAction(handler);
      }
    },
  };
};

export const createAgentSignalMiddlewareInstallContext = (
  registries: AgentSignalMiddlewareRegistries,
): AgentSignalMiddlewareInstallContext => {
  return {
    handleAction(handler) {
      for (const listen of toListenArray(handler.listen)) {
        registries.actionRegistry.register(listen, handler.handler);
      }
    },
    handleSignal(handler) {
      for (const listen of toListenArray(handler.listen)) {
        registries.signalRegistry.register(listen, handler.handler);
      }
    },
    handleSource(handler) {
      for (const listen of toListenArray(handler.listen)) {
        registries.sourceRegistry.register(listen, handler.handler);
      }
    },
  };
};
