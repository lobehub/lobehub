import type { AgentSignalSource, BaseAction, BaseSignal } from './types';

/**
 * Minimal handler contract used by the semantic registries.
 */
export interface AgentSignalHandler<TInput = unknown, TResult = unknown> {
  handle: (input: TInput) => Promise<TResult> | TResult;
  id: string;
}

interface RegistryEntry {
  id: string;
}

/**
 * Registry contract for source processors, signal processors, and action handlers.
 */
export interface AgentSignalRegistry<TEntry extends RegistryEntry> {
  list: (type?: string) => TEntry[];
  match: (type: string) => TEntry[];
  register: (type: string, entry: TEntry) => this;
}

/**
 * Source processor contract.
 */
export interface SourceProcessor extends AgentSignalHandler<AgentSignalSource> {}

/**
 * Signal processor contract.
 */
export interface SignalProcessor extends AgentSignalHandler<BaseSignal> {}

/**
 * Action handler contract.
 */
export interface ActionHandler extends AgentSignalHandler<BaseAction> {}

/**
 * Registry for source processors.
 */
export interface SourceProcessorRegistry extends AgentSignalRegistry<SourceProcessor> {}

/**
 * Registry for signal processors.
 */
export interface SignalProcessorRegistry extends AgentSignalRegistry<SignalProcessor> {}

/**
 * Registry for action handlers.
 */
export interface ActionHandlerRegistry extends AgentSignalRegistry<ActionHandler> {}

const createRegistry = <TEntry extends RegistryEntry>(): AgentSignalRegistry<TEntry> => {
  const entries = new Map<string, TEntry[]>();

  const registry: AgentSignalRegistry<TEntry> = {
    list(type?: string) {
      if (type) return [...(entries.get(type) ?? [])];

      const collected: TEntry[] = [];
      for (const value of entries.values()) {
        collected.push(...value);
      }

      return collected;
    },
    match(type: string) {
      return [...(entries.get(type) ?? [])];
    },
    register(type: string, entry: TEntry) {
      const current = entries.get(type);
      if (current) {
        current.push(entry);
      } else {
        entries.set(type, [entry]);
      }

      return registry;
    },
  };

  return registry;
};

/** Creates a registry for source processors. */
export const createSourceProcessorRegistry = (): SourceProcessorRegistry => {
  return createRegistry<SourceProcessor>();
};

/** Creates a registry for signal processors. */
export const createSignalProcessorRegistry = (): SignalProcessorRegistry => {
  return createRegistry<SignalProcessor>();
};

/** Creates a registry for action handlers. */
export const createActionHandlerRegistry = (): ActionHandlerRegistry => {
  return createRegistry<ActionHandler>();
};
