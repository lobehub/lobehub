import type { MockCase } from '../../types';

export interface GeneratorDef<TParams = unknown> {
  defaultParams: TParams;
  description?: string;
  factory: (params: TParams) => MockCase;
  id: string;
  name: string;
}

const registry = new Map<string, GeneratorDef<any>>();

export function defineGenerator<T>(def: GeneratorDef<T>): GeneratorDef<T> {
  registry.set(def.id, def);
  return def;
}

export function getGenerator(id: string): GeneratorDef | undefined {
  return registry.get(id);
}

export const GENERATORS = registry;
