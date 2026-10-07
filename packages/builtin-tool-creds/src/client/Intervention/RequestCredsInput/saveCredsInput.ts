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
 * Whether the user can save into the scope the agent reads. Personal
 * credentials are always the user's own; workspace credentials need the
 * workspace's credential-management permission, so a member without it gets
 * an explanation instead of a form whose every save would be refused.
 * Falling back to personal credentials would not help: inside a workspace the
 * agent only reads the workspace's credentials.
 */
export const canSaveCredsInput = ({
  canManageWorkspaceCreds,
  isWorkspace,
}: {
  canManageWorkspaceCreds: boolean;
  isWorkspace: boolean;
}) => !isWorkspace || canManageWorkspaceCreds;

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

export type CredsInputSubmitStage = 'approve' | 'save';

const sameValues = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([key, value]) => b[key] === value);

/**
 * Submit handler for the secure form: write the values, then approve the
 * call. The two steps fail independently. When the write succeeded but the
 * approval did not, a retry with the same values only approves again; if the
 * user edited a field in between, the new values are written first, so the
 * approved credential is always what the form shows. `onError` gets the failed
 * stage so the card can say which one to retry.
 */
export const createCredsInputSubmit = ({
  approve,
  onError,
  save,
}: {
  approve: () => Promise<void>;
  onError: (stage: CredsInputSubmitStage) => void;
  save: (values: Record<string, string>) => Promise<void>;
}) => {
  let savedValues: Record<string, string> | undefined;

  return async (values: Record<string, string>) => {
    if (!savedValues || !sameValues(values, savedValues)) {
      try {
        await save(values);
      } catch (error) {
        onError('save');
        throw error;
      }
      savedValues = { ...values };
    }

    try {
      await approve();
    } catch (error) {
      onError('approve');
      throw error;
    }
  };
};
