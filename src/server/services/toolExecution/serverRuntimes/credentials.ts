import { CredentialsIdentifier } from '@lobechat/builtin-tool-credentials';
import {
  type CredentialItem,
  CredentialsExecutionRuntime,
  type CredentialsRuntimeService,
} from '@lobechat/builtin-tool-credentials/executionRuntime';

import { UserModel } from '@/database/models/user';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';

import { type ServerRuntimeRegistration } from './types';

const normalizePath = (rawPath: string) =>
  rawPath
    .trim()
    .replaceAll(/\.+/g, '.')
    .replaceAll(/^\.|\.$/g, '');

const pathSegments = (path: string) => normalizePath(path).split('.').filter(Boolean);

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return !!value && typeof value === 'object' && !Array.isArray(value);
};

const getValueAtPath = (obj: Record<string, any>, path: string): unknown => {
  const segments = pathSegments(path);
  let cursor: unknown = obj;

  for (const segment of segments) {
    if (!isPlainObject(cursor)) return undefined;

    cursor = cursor[segment];
  }

  return cursor;
};

const setValueAtPath = (obj: Record<string, any>, path: string, value: string) => {
  const segments = pathSegments(path);
  if (segments.length === 0) return;

  let cursor: Record<string, any> = obj;

  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }

    cursor = cursor[segment];
  }

  cursor[segments.at(-1)!] = value;
};

const deleteAtPath = (obj: Record<string, any>, path: string): boolean => {
  const segments = pathSegments(path);
  if (segments.length === 0) return false;

  const stack: Array<{ key: string; parent: Record<string, any> }> = [];
  let cursor: Record<string, any> = obj;

  for (const segment of segments.slice(0, -1)) {
    if (!isPlainObject(cursor[segment])) return false;

    stack.push({ key: segment, parent: cursor });
    cursor = cursor[segment];
  }

  const finalKey = segments.at(-1)!;
  if (!(finalKey in cursor)) return false;

  delete cursor[finalKey];

  // cleanup empty objects from leaf to root
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const item = stack[index];
    const node = item.parent[item.key];
    if (!isPlainObject(node)) continue;
    if (Object.keys(node).length > 0) break;

    delete item.parent[item.key];
  }

  return true;
};

const flattenStringLeaves = (obj: Record<string, any>, prefix: string[] = []): CredentialItem[] => {
  const items: CredentialItem[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const path = [...prefix, key];

    if (typeof value === 'string') {
      items.push({ path: path.join('.'), value });
      continue;
    }

    if (isPlainObject(value)) {
      items.push(...flattenStringLeaves(value, path));
    }
  }

  return items;
};

export const credentialsRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Credentials execution');
    }

    if (!context.serverDB) {
      throw new Error('serverDB is required for Credentials execution');
    }

    const userModel = new UserModel(context.serverDB, context.userId);
    const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

    const readVaults = async (): Promise<Record<string, any>> => {
      const userSettings = await userModel.getUserSettings();
      return await KeyVaultsGateKeeper.getUserKeyVaults(
        (userSettings?.keyVaults as string | null) || null,
        context.userId,
      );
    };

    const writeVaults = async (nextKeyVaults: Record<string, any>) => {
      const encrypted = await gateKeeper.encrypt(JSON.stringify(nextKeyVaults));
      await userModel.updateSetting({ keyVaults: encrypted });
    };

    const service: CredentialsRuntimeService = {
      deleteCredential: async (path: string) => {
        const keyVaults = await readVaults();
        const deleted = deleteAtPath(keyVaults, path);
        if (!deleted) return false;

        await writeVaults(keyVaults);

        return true;
      },
      getCredential: async (path: string) => {
        const keyVaults = await readVaults();
        const value = getValueAtPath(keyVaults, path);

        return typeof value === 'string' ? value : undefined;
      },
      listCredentials: async (prefix?: string) => {
        const keyVaults = await readVaults();
        const allItems = flattenStringLeaves(keyVaults);

        if (!prefix) return allItems;

        const normalizedPrefix = normalizePath(prefix);

        return allItems.filter(
          (item) => item.path === normalizedPrefix || item.path.startsWith(`${normalizedPrefix}.`),
        );
      },
      setCredential: async (path: string, value: string) => {
        const keyVaults = await readVaults();
        setValueAtPath(keyVaults, path, value);
        await writeVaults(keyVaults);
      },
    };

    return new CredentialsExecutionRuntime({ service });
  },
  identifier: CredentialsIdentifier,
};
