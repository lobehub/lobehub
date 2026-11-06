import type { AgentEvalDatasetPackage, AgentEvalDatasetPackageBindings } from '@lobechat/types';

import type { NewUserConnector } from '../../schemas';
import { getReferencedPackageConnections, validatePackageConnectionSelections } from './bindings';
import { AgentEvalDatasetPackageImportError } from './errors';

export interface EvalPackageCredentialEncryptor {
  encrypt: (plaintext: string) => Promise<string>;
}

/** Prepare ciphertext before entering the import transaction; no network or plaintext persistence. */
export const preparePackageConnections = async (
  pack: AgentEvalDatasetPackage,
  selections: AgentEvalDatasetPackageBindings | undefined,
  encryptor?: EvalPackageCredentialEncryptor,
) => {
  validatePackageConnectionSelections(pack, selections);
  const rows: Array<{
    key: string;
    row: Omit<NewUserConnector, 'userId' | 'workspaceId'> & { id: string };
  }> = [];
  for (const key of getReferencedPackageConnections(pack, selections)) {
    const definition = Object.hasOwn(pack.connections ?? {}, key)
      ? pack.connections?.[key]
      : undefined;
    if (!definition)
      throw new AgentEvalDatasetPackageImportError('A package mock connection is missing');
    let credentials: string | null = null;
    if (definition.credentials) {
      if (!encryptor)
        throw new AgentEvalDatasetPackageImportError('Secure connection storage is unavailable');
      try {
        credentials = await encryptor.encrypt(JSON.stringify(definition.credentials));
      } catch {
        throw new AgentEvalDatasetPackageImportError(
          'Could not securely store the mock connection',
        );
      }
    }
    const id = crypto.randomUUID();
    rows.push({
      key,
      row: {
        credentials,
        id,
        identifier: `eval-mock-${id}`,
        isEnabled: true,
        mcpConnectionType: 'http',
        mcpServerUrl: definition.url,
        name: definition.name,
        sourceType: 'custom',
        status: 'disconnected',
      },
    });
  }
  return rows;
};
