import type { LobeRuntimeAI } from '../BaseAI';

export interface RuntimeItem {
  id: string;
  models?: string[] | (() => Promise<string[]>);
  runtime: LobeRuntimeAI;
}

export type { UniformRuntime } from './createRuntime';
export { createRouterRuntime } from './createRuntime';
