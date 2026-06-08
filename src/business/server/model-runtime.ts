import type { ModelRuntimeHooks } from '@lobechat/model-runtime';

export function getBusinessModelRuntimeHooks(
  _userId: string,
  _provider: string,
  _workspaceId?: string,
): ModelRuntimeHooks | undefined {
  return undefined;
}
