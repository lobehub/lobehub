import type { BuiltinServerRuntimeOutput } from '@lobechat/types';

import type {
  DeleteCredentialParams,
  GetCredentialParams,
  ListCredentialsParams,
  ListedCredentialItem,
  SetCredentialParams,
} from '../types';

export interface CredentialItem {
  path: string;
  value: string;
}

export interface CredentialsRuntimeService {
  deleteCredential: (path: string) => Promise<boolean>;
  getCredential: (path: string) => Promise<string | undefined>;
  listCredentials: (prefix?: string) => Promise<CredentialItem[]>;
  setCredential: (path: string, value: string) => Promise<void>;
}

export interface CredentialsExecutionRuntimeOptions {
  service: CredentialsRuntimeService;
}

const MASK_MIN_PREFIX = 2;
const MASK_MIN_SUFFIX = 2;

const normalizePath = (rawPath: string) =>
  rawPath
    .trim()
    .replaceAll(/\.+/g, '.')
    .replaceAll(/^\.|\.$/g, '');

const isValidPath = (path: string) => /^[\w-]+(?:\.[\w-]+)*$/.test(path);

const maskValue = (value: string) => {
  if (!value) return '';
  if (value.length <= MASK_MIN_PREFIX + MASK_MIN_SUFFIX) return '*'.repeat(value.length);

  const prefix = value.slice(0, MASK_MIN_PREFIX);
  const suffix = value.slice(-MASK_MIN_SUFFIX);
  const middle = '*'.repeat(Math.max(4, value.length - MASK_MIN_PREFIX - MASK_MIN_SUFFIX));

  return `${prefix}${middle}${suffix}`;
};

export class CredentialsExecutionRuntime {
  private readonly service: CredentialsRuntimeService;

  constructor(options: CredentialsExecutionRuntimeOptions) {
    this.service = options.service;
  }

  async setCredential(args: SetCredentialParams): Promise<BuiltinServerRuntimeOutput> {
    const path = normalizePath(args.path || '');
    const value = typeof args.value === 'string' ? args.value : '';

    if (!path || !isValidPath(path)) {
      return {
        content:
          'Invalid credential path. Use dot path with letters/numbers/underscore/hyphen, e.g. moltbook.apiKey (or compatibility path sandboxEnv.MOLTBOOK_API_KEY).',
        success: false,
      };
    }

    if (!value) {
      return {
        content: 'Credential value cannot be empty.',
        success: false,
      };
    }

    try {
      await this.service.setCredential(path, value);

      return {
        content: `Credential saved at ${path}.`,
        state: {
          path,
          updatedAt: new Date().toISOString(),
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to save credential at ${path}: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async getCredential(args: GetCredentialParams): Promise<BuiltinServerRuntimeOutput> {
    const path = normalizePath(args.path || '');

    if (!path || !isValidPath(path)) {
      return {
        content:
          'Invalid credential path. Examples: moltbook.apiKey, github.token, sandboxEnv.MOLTBOOK_API_KEY',
        success: false,
      };
    }

    try {
      const value = await this.service.getCredential(path);

      if (value === undefined) {
        return {
          content: `Credential not found at ${path}.`,
          state: {
            exists: false,
            path,
          },
          success: true,
        };
      }

      const reveal = args.reveal === true;

      return {
        content: reveal
          ? `Credential at ${path}: ${value}`
          : `Credential exists at ${path}: ${maskValue(value)}`,
        state: {
          exists: true,
          path,
          ...(reveal ? { value } : { valueMasked: maskValue(value) }),
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to read credential at ${path}: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async deleteCredential(args: DeleteCredentialParams): Promise<BuiltinServerRuntimeOutput> {
    const path = normalizePath(args.path || '');

    if (!path || !isValidPath(path)) {
      return {
        content:
          'Invalid credential path. Examples: moltbook.apiKey, github.token, sandboxEnv.MOLTBOOK_API_KEY',
        success: false,
      };
    }

    try {
      const deleted = await this.service.deleteCredential(path);

      return {
        content: deleted
          ? `Credential deleted at ${path}.`
          : `Credential not found at ${path}, nothing deleted.`,
        state: {
          deleted,
          path,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to delete credential at ${path}: ${(e as Error).message}`,
        success: false,
      };
    }
  }

  async listCredentials(args: ListCredentialsParams = {}): Promise<BuiltinServerRuntimeOutput> {
    const prefix = args.prefix ? normalizePath(args.prefix) : undefined;

    if (prefix && !isValidPath(prefix)) {
      return {
        content: 'Invalid prefix path. Examples: moltbook, providers.github, sandboxEnv',
        success: false,
      };
    }

    try {
      const allItems = await this.service.listCredentials(prefix);
      const items = allItems;

      if (items.length === 0) {
        return {
          content: prefix
            ? `No credentials found under prefix ${prefix}.`
            : 'No credentials found in keyVaults.',
          state: {
            items: [],
            prefix,
            total: 0,
          },
          success: true,
        };
      }

      const maskedItems: ListedCredentialItem[] = items.map((item) => ({
        path: item.path,
        valueMasked: maskValue(item.value),
      }));

      const lines = maskedItems.map(
        (item, index) => `${index + 1}. ${item.path} = ${item.valueMasked}`,
      );

      return {
        content: `Found ${allItems.length} credential(s)${prefix ? ` under ${prefix}` : ''}:\n${lines.join('\n')}`,
        state: {
          items: maskedItems,
          prefix,
          total: allItems.length,
        },
        success: true,
      };
    } catch (e) {
      return {
        content: `Failed to list credentials: ${(e as Error).message}`,
        success: false,
      };
    }
  }
}
