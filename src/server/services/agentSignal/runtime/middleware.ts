import type { AgentSignalSource, BaseAction, BaseSignal } from '@lobechat/agent-signal';

import type {
  AgentSignalPolicyActionType,
  AgentSignalPolicyActionVariant,
  AgentSignalPolicySignalType,
  AgentSignalPolicySignalVariant,
} from '../policies/types';
import type { AgentSignalSourceType, AgentSignalSourceVariant } from '../sourceTypes';
import type {
  AgentSignalSchedulerHandle,
  AgentSignalSchedulerHandler,
  AgentSignalSchedulerRegistry,
} from './AgentSignalScheduler';
import type { RuntimeNode } from './context';

type OneOrMany<TValue extends string> = TValue | readonly TValue[];

type ExtractListenType<TListen extends OneOrMany<string>> =
  TListen extends readonly (infer TValue)[] ? Extract<TValue, string> : TListen;

type ResolveSourceHandlerInput<TListen extends OneOrMany<string>> =
  ExtractListenType<TListen> extends infer TType extends string
    ? TType extends AgentSignalSourceType
      ? AgentSignalSourceVariant<TType>
      : AgentSignalSource
    : never;

type ResolveSignalHandlerInput<TListen extends OneOrMany<string>> =
  ExtractListenType<TListen> extends infer TType extends string
    ? TType extends AgentSignalPolicySignalType
      ? AgentSignalPolicySignalVariant<TType>
      : BaseSignal
    : never;

type ResolveActionHandlerInput<TListen extends OneOrMany<string>> =
  ExtractListenType<TListen> extends infer TType extends string
    ? TType extends AgentSignalPolicyActionType
      ? AgentSignalPolicyActionVariant<TType>
      : BaseAction
    : never;

export interface AgentSignalSourceHandlerDefinition<TListen extends OneOrMany<string> = string> {
  handle: AgentSignalSchedulerHandle<ResolveSourceHandlerInput<TListen>>;
  id: string;
  listen: TListen;
  type: 'source';
}

export interface AgentSignalSignalHandlerDefinition<TListen extends OneOrMany<string> = string> {
  handle: AgentSignalSchedulerHandle<ResolveSignalHandlerInput<TListen>>;
  id: string;
  listen: TListen;
  type: 'signal';
}

export interface AgentSignalActionHandlerDefinition<TListen extends OneOrMany<string> = string> {
  handle: AgentSignalSchedulerHandle<ResolveActionHandlerInput<TListen>>;
  id: string;
  listen: TListen;
  type: 'action';
}

export type AgentSignalHandlerDefinition =
  | AgentSignalActionHandlerDefinition
  | AgentSignalSignalHandlerDefinition
  | AgentSignalSourceHandlerDefinition;

type AgentSignalInstallableHandlerDefinition =
  | {
      handle: unknown;
      id: string;
      listen: OneOrMany<string>;
      type: 'action';
    }
  | {
      handle: unknown;
      id: string;
      listen: OneOrMany<string>;
      type: 'signal';
    }
  | {
      handle: unknown;
      id: string;
      listen: OneOrMany<string>;
      type: 'source';
    };

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

const toListenArray = (listen: OneOrMany<string>) => {
  return Array.isArray(listen) ? listen : [listen];
};

const resolveSchedulerHandler = <TNode extends RuntimeNode>(
  idOrHandler: AgentSignalSchedulerHandler<TNode> | string,
  handle?: AgentSignalSchedulerHandle<TNode>,
): AgentSignalSchedulerHandler<TNode> => {
  if (typeof idOrHandler === 'string') {
    if (!handle) {
      throw new TypeError('Missing handler function for define*Handler call.');
    }

    return {
      handle,
      id: idOrHandler,
    };
  }

  return idOrHandler;
};

export const defineSourceHandler = <TListen extends OneOrMany<string>>(
  listen: TListen,
  idOrHandler: AgentSignalSchedulerHandler<ResolveSourceHandlerInput<TListen>> | string,
  handle?: AgentSignalSchedulerHandle<ResolveSourceHandlerInput<TListen>>,
): AgentSignalSourceHandlerDefinition<TListen> => {
  const handler = resolveSchedulerHandler(idOrHandler, handle);

  return {
    handle: handler.handle,
    id: handler.id,
    listen,
    type: 'source',
  };
};

export const defineSignalHandler = <TListen extends OneOrMany<string>>(
  listen: TListen,
  idOrHandler: AgentSignalSchedulerHandler<ResolveSignalHandlerInput<TListen>> | string,
  handle?: AgentSignalSchedulerHandle<ResolveSignalHandlerInput<TListen>>,
): AgentSignalSignalHandlerDefinition<TListen> => {
  const handler = resolveSchedulerHandler(idOrHandler, handle);

  return {
    handle: handler.handle,
    id: handler.id,
    listen,
    type: 'signal',
  };
};

export const defineActionHandler = <TListen extends OneOrMany<string>>(
  listen: TListen,
  idOrHandler: AgentSignalSchedulerHandler<ResolveActionHandlerInput<TListen>> | string,
  handle?: AgentSignalSchedulerHandle<ResolveActionHandlerInput<TListen>>,
): AgentSignalActionHandlerDefinition<TListen> => {
  const handler = resolveSchedulerHandler(idOrHandler, handle);

  return {
    handle: handler.handle,
    id: handler.id,
    listen,
    type: 'action',
  };
};

export const defineAgentSignalHandlers = (
  handlers: readonly AgentSignalInstallableHandlerDefinition[],
): AgentSignalMiddleware => {
  return {
    install(context) {
      for (const handler of handlers) {
        if (handler.type === 'source') {
          context.handleSource(handler as AgentSignalSourceHandlerDefinition);
          continue;
        }

        if (handler.type === 'signal') {
          context.handleSignal(handler as AgentSignalSignalHandlerDefinition);
          continue;
        }

        context.handleAction(handler as AgentSignalActionHandlerDefinition);
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
        registries.actionRegistry.register(listen, {
          handle: handler.handle,
          id: handler.id,
        } as AgentSignalSchedulerHandler<BaseAction>);
      }
    },
    handleSignal(handler) {
      for (const listen of toListenArray(handler.listen)) {
        registries.signalRegistry.register(listen, {
          handle: handler.handle,
          id: handler.id,
        } as AgentSignalSchedulerHandler<BaseSignal>);
      }
    },
    handleSource(handler) {
      for (const listen of toListenArray(handler.listen)) {
        registries.sourceRegistry.register(listen, {
          handle: handler.handle,
          id: handler.id,
        } as AgentSignalSchedulerHandler<AgentSignalSource>);
      }
    },
  };
};
