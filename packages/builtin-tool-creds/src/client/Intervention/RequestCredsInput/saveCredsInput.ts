import type { RequestCredsInputParams } from '../../../types';

/**
 * The slice of the `market.creds` / `workspaceCreds` tRPC clients the secure
 * form writes through. Structural so the logic stays testable without the app.
 */
export interface CredsWriteClient {
  createKV: {
    mutate: (input: {
      description?: string;
      key: string;
      name: string;
      type: 'kv-env' | 'kv-header';
      values: Record<string, string>;
    }) => Promise<unknown>;
  };
  list: {
    query: () => Promise<{ data?: Array<{ id: number; key: string; ownerType?: string }> }>;
  };
  update: {
    mutate: (input: {
      description?: string;
      id: number;
      name?: string;
      values?: Record<string, string>;
    }) => Promise<unknown>;
  };
}

/**
 * Finds a credential the scoped API can overwrite. A workspace list also holds
 * members' shared personal credentials, which only their owners can write.
 */
export const findWritableCred = async (
  client: CredsWriteClient,
  key: string,
  isWorkspace: boolean,
) => {
  const { data } = await client.list.query();
  return data?.find((cred) => cred.key === key && (!isWorkspace || cred.ownerType !== 'user'));
};

/**
 * Writes the form's values to the credential store: updates the credential
 * with the same key when the scope can write it, creates one otherwise.
 * Re-reads the list instead of trusting what the card showed, since the key
 * may have been created elsewhere in the meantime.
 */
export const saveCredsInput = async (
  client: CredsWriteClient,
  args: RequestCredsInputParams,
  isWorkspace: boolean,
  values: Record<string, string>,
) => {
  const writable = await findWritableCred(client, args.key, isWorkspace);

  if (writable) {
    await client.update.mutate({
      description: args.description,
      id: writable.id,
      name: args.name,
      values,
    });
  } else {
    await client.createKV.mutate({
      description: args.description,
      key: args.key,
      name: args.name || args.key,
      type: args.type,
      values,
    });
  }
};
