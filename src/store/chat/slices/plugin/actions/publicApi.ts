import { type ChatToolPayload, type RuntimeStepContext } from '@lobechat/types';

import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

/**
 * Public API for plugin operations
 * These methods are called by UI components or other business scenarios
 */

type Setter = StoreSetter<ChatStore>;
export const pluginPublicApi = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginPublicApiActionImpl(set, get, _api);

export class PluginPublicApiActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  internal_invokeDifferentTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ): Promise<any> => {
    switch (payload.type) {
      // @ts-ignore
      case 'mcp': {
        return await this.#get().invokeMCPTypePlugin(id, payload);
      }

      case 'builtin':
      default: {
        // Pass stepContext to builtin tools for dynamic state access
        return await this.#get().invokeBuiltinTool(id, payload, stepContext);
      }
    }
  };
}

export type PluginPublicApiAction = Pick<
  PluginPublicApiActionImpl,
  keyof PluginPublicApiActionImpl
>;
