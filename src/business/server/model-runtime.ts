import type { ModelRuntimeHooks } from '@lobechat/model-runtime';

export function getBusinessModelRuntimeHooks(
  _userId: string,
  _provider: string,
): ModelRuntimeHooks | undefined {
  return undefined;
}
