import type { ConnectorToolPermission } from '@/database/schemas';
import { lambdaClient } from '@/libs/trpc/client';
import type { StoreSetter } from '@/store/types';

import type { ToolStore } from '../../store';

type Setter = StoreSetter<ToolStore>;

export const createConnectorSlice = (set: Setter, get: () => ToolStore, _api?: unknown) =>
  new ConnectorActionImpl(set, get, _api);

export class ConnectorActionImpl {
  readonly #set: Setter;

  constructor(set: Setter, _get: () => ToolStore, _api?: unknown) {
    void _api;
    this.#set = set;
  }

  fetchConnectors = async (): Promise<void> => {
    const data = await lambdaClient.connector.list.query();
    this.#set({ connectors: data as any, isConnectorsInit: true }, false, 'fetchConnectors');
  };

  createConnector = async (
    params: Parameters<typeof lambdaClient.connector.create.mutate>[0],
  ): Promise<void> => {
    this.#set({ connectorCreating: true }, false, 'createConnector/start');
    try {
      await lambdaClient.connector.create.mutate(params);
      await this.fetchConnectors();
    } finally {
      this.#set({ connectorCreating: false }, false, 'createConnector/end');
    }
  };

  deleteConnector = async (id: string): Promise<void> => {
    await lambdaClient.connector.delete.mutate({ id });
    await this.fetchConnectors();
  };

  syncConnectorTools = async (id: string): Promise<void> => {
    this.#set(
      (s) => ({ connectorSyncing: { ...s.connectorSyncing, [id]: true } }),
      false,
      'syncConnectorTools/start',
    );
    try {
      await lambdaClient.connector.syncTools.mutate({ id });
      await this.fetchConnectors();
    } finally {
      this.#set(
        (s) => ({ connectorSyncing: { ...s.connectorSyncing, [id]: false } }),
        false,
        'syncConnectorTools/end',
      );
    }
  };

  disconnectConnector = async (id: string): Promise<void> => {
    await lambdaClient.connector.update.mutate({
      id,
      patch: { isEnabled: false },
    });
    await this.fetchConnectors();
  };

  updateToolPermission = async (
    toolId: string,
    permission: ConnectorToolPermission,
  ): Promise<void> => {
    // Optimistic update
    this.#set(
      (s) => ({
        connectors: s.connectors.map((c) => ({
          ...c,
          tools: c.tools.map((t) => (t.id === toolId ? { ...t, permission } : t)),
        })),
      }),
      false,
      'updateToolPermission/optimistic',
    );

    try {
      await lambdaClient.connector.updateToolPermission.mutate({ permission, toolId });
    } catch {
      // Roll back on error
      await this.fetchConnectors();
    }
  };
}

export type ConnectorAction = ReturnType<typeof createConnectorSlice>;
