import { reject } from './reject';

export const lambdaClient = reject('lambdaClient');
export const asyncClient = reject('asyncClient');
export const toolsClient = reject('toolsClient');
export const lambdaQuery = reject('lambdaQuery');
export const createWorkspaceLambdaClient = reject('createWorkspaceLambdaClient');

// Workbench never relays an LLM call to a tab, so a call carries no relay headers.
export const withLlmRelay = (_relay?: {
  headers: Record<string, string>;
}): { context: Record<string, unknown> } | undefined => undefined;
