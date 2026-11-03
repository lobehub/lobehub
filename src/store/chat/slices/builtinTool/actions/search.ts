import { WebBrowsingApiName, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { type ChatToolPayload, type SearchQuery } from '@lobechat/types';

import { dbMessageSelectors } from '@/store/chat/selectors';
import { type ChatStore } from '@/store/chat/store';
import { type StoreSetter } from '@/store/types';

type Setter = StoreSetter<ChatStore>;
export const searchSlice = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new SearchActionImpl(set, get, _api);

export class SearchActionImpl {
  readonly #get: () => ChatStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  togglePageContent = (url: string): void => {
    this.#set({ activePageContentUrl: url });
  };

  triggerSearchAgain = async (id: string, data: SearchQuery): Promise<void> => {
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
    if (!message) return;

    // Get operationId from messageOperationMap to ensure proper context isolation
    const operationId = this.#get().messageOperationMap[id];
    const context = operationId ? { operationId } : undefined;

    // 1. Update plugin arguments
    await this.#get().optimisticUpdatePluginArguments(id, data, false, context);

    // 2. Call the Tool Store Executor via invokeBuiltinTool
    const payload = {
      apiName: WebBrowsingApiName.search,
      arguments: JSON.stringify(data),
      // Use tool_call_id from message, or generate one if not available
      id: message.tool_call_id,
      identifier: WebBrowsingManifest.identifier,
      type: 'builtin',
    } as ChatToolPayload;

    await this.#get().invokeBuiltinTool(id, payload);
  };
}

export type SearchAction = Pick<SearchActionImpl, keyof SearchActionImpl>;
