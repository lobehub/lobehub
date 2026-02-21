import type { LobeRuntimeAI } from '../BaseAI';

export interface RuntimeItem {
  id: string;
  models?: string[] | (() => Promise<string[]>);
  runtime: LobeRuntimeAI;
}

export type { CreateRouterRuntimeOptions, RouteAttemptResult, UniformRuntime } from './createRuntime';
export { createRouterRuntime } from './createRuntime';
