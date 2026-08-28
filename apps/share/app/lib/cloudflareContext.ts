import { createContext } from 'react-router';

export interface WorkerExecutionContext {
  passThroughOnException: () => void;
  waitUntil: (promise: Promise<unknown>) => void;
}

export const cloudflareContext = createContext<{
  ctx: WorkerExecutionContext;
  env: Record<string, unknown>;
}>();
