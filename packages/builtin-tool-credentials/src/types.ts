export const CredentialsIdentifier = 'lobe-credentials';

export const CredentialsApiName = {
  deleteCredential: 'deleteCredential',
  getCredential: 'getCredential',
  listCredentials: 'listCredentials',
  setCredential: 'setCredential',
} as const;

export type CredentialsApiNameType = (typeof CredentialsApiName)[keyof typeof CredentialsApiName];

export interface SetCredentialParams {
  /**
   * Dot path in keyVaults, e.g. "moltbook.apiKey" or compatibility path "sandboxEnv.MOLTBOOK_API_KEY".
   */
  path: string;
  /**
   * Secret value to store.
   */
  value: string;
}

export interface SetCredentialState {
  path: string;
  updatedAt: string;
}

export interface GetCredentialParams {
  /**
   * Dot path in keyVaults.
   */
  path: string;
  /**
   * Whether to reveal full plaintext value in tool content.
   * Defaults to false (masked).
   */
  reveal?: boolean;
}

export interface GetCredentialState {
  exists: boolean;
  path: string;
  value?: string;
  valueMasked?: string;
}

export interface DeleteCredentialParams {
  /**
   * Dot path in keyVaults.
   */
  path: string;
}

export interface DeleteCredentialState {
  deleted: boolean;
  path: string;
}

export interface ListCredentialsParams {
  /**
   * Optional path prefix filter (e.g. "sandboxEnv" or "moltbook").
   */
  prefix?: string;
}

export interface ListedCredentialItem {
  path: string;
  valueMasked: string;
}

export interface ListCredentialsState {
  items: ListedCredentialItem[];
  prefix?: string;
  total: number;
}
