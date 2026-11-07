import type {
  AgentEvalDatasetPackage,
  AgentEvalDatasetPackageBindings,
  EvalEnvironmentConnection,
} from '@lobechat/types';

import { getReferencedPackageConnections, validatePackageConnectionSelections } from './bindings';
import { AgentEvalDatasetPackageImportError } from './errors';

export interface EvalPackageCredentialEncryptor {
  encrypt: (plaintext: string) => Promise<string>;
}

/**
 * Encrypts the package connections the import stores in Environments, before
 * entering the import transaction; no network and no plaintext persistence.
 */
export const preparePackageConnections = async (
  pack: AgentEvalDatasetPackage,
  selections: AgentEvalDatasetPackageBindings | undefined,
  encryptor?: EvalPackageCredentialEncryptor,
) => {
  validatePackageConnectionSelections(pack, selections);
  const connections = new Map<string, EvalEnvironmentConnection>();
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
    connections.set(key, { credentials, name: definition.name, url: definition.url });
  }
  return connections;
};
