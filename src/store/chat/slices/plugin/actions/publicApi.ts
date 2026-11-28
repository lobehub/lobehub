import { type ChatToolPayload, type RuntimeStepContext } from '@lobechat/types';

import { messageService } from '@/services/message';
import { type ChatStore } from '@/store/chat/store';
import { getElectronStoreState } from '@/store/electron';
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
    authorization?: { expectedDeviceId?: string; assistantMessageId?: string },
  ): Promise<any> => {
    const store = this.#get();
    const message = Object.values(store.dbMessagesMap)
      .flat()
      .find((item) => item.id === id);
    if (message?.agentId)
      await messageService.assertToolDispatch({
        agentId: message.agentId,
        topicId: message.topicId ?? undefined,
        identifier: payload.identifier,
        apiName: payload.apiName,
        assistantMessageId: authorization?.assistantMessageId ?? message.parentId ?? undefined,
        expectedDeviceId:
          authorization?.expectedDeviceId ?? getElectronStoreState().gatewayDeviceInfo?.deviceId,
      });
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
