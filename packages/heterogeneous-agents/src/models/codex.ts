import path from 'node:path';

import type { HeterogeneousAgentModel } from '@lobechat/types';
import { isRecord } from '@lobechat/utils/object';

import { CodexAppServerClient, CodexAppServerRpcError } from '../codex/CodexAppServerClient';

interface CodexModelCatalogOptions {
  args?: string[];
  commandPath: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

/** Discovery has no thread: provider overrides must be applied at process startup. */
const catalogConfig = (source: string[], initialCwd: string) => {
  const args: string[] = [];
  let cwd = initialCwd;
  const valueFlags = ['-c', '--config', '-C', '--cd', '--enable', '--disable'];

  for (let index = 0; index < source.length; index += 1) {
    const arg = source[index];
    if (arg === '--') break;
    // app-server does not support runtime profiles or exec's local-provider selection.
    // Falling back is safer than advertising a different provider's catalog.
    if (
      ['-p', '--profile', '--oss', '--local-provider', '--ignore-user-config'].some(
        (flag) =>
          arg === flag || arg.startsWith(`${flag}=`) || (flag === '-p' && arg.startsWith('-p')),
      )
    ) {
      throw Object.assign(new Error('Unsupported Codex catalog configuration'), {
        code: 'unsupported_configuration',
      });
    }
    const flag = valueFlags.find(
      (candidate) =>
        arg === candidate ||
        arg.startsWith(`${candidate}=`) ||
        (candidate.length === 2 && arg.startsWith(candidate)),
    );
    if (!flag) continue;
    const value = arg === flag ? source[++index] : arg.slice(flag.length).replace(/^=/, '');
    if (!value) throw new Error(`Missing value for Codex ${flag}`);

    if (flag === '-C' || flag === '--cd') cwd = path.resolve(initialCwd, value);
    else args.push(flag, value);
  }

  return { args, cwd };
};

/** A short-lived catalog connection, independent of the exec/app-server task transport. */
export const listCodexModels = async ({
  args = [],
  commandPath,
  cwd,
  env,
  timeoutMs,
}: CodexModelCatalogOptions): Promise<HeterogeneousAgentModel[]> => {
  const config = catalogConfig(args, cwd);
  const client = new CodexAppServerClient({
    ...config,
    clientVersion: '1.0.0',
    commandPath,
    env,
    reconnectMaxAttempts: 0,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;

  const readPages = async () => {
    const models = new Map<string, HeterogeneousAgentModel>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await client.request<unknown>('model/list', {
        ...(cursor ? { cursor } : {}),
        includeHidden: false,
        limit: 100,
      });
      if (!isRecord(page) || !Array.isArray(page.data)) {
        throw new Error('Invalid Codex model catalog');
      }
      for (const item of page.data) {
        if (!isRecord(item) || typeof item.model !== 'string' || !item.model.trim()) {
          throw new Error('Invalid Codex model catalog entry');
        }
        if (item.hidden === true || models.has(item.model)) continue;
        // `model`, not the catalog entry's `id`, is accepted by codex exec --model.
        models.set(item.model, {
          id: item.model,
          ...(typeof item.displayName === 'string' && item.displayName.trim()
            ? { label: item.displayName }
            : {}),
          modelId: item.model,
          providerId: 'codex',
        });
      }
      if (page.nextCursor == null) break;
      if (typeof page.nextCursor !== 'string' || !page.nextCursor || cursors.has(page.nextCursor)) {
        throw new Error('Invalid Codex model catalog cursor');
      }
      cursor = page.nextCursor;
      cursors.add(cursor);
    } while (cursor);
    return [...models.values()];
  };

  try {
    return await Promise.race([
      readPages(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(new Error('Codex model discovery timed out'), { code: 'ETIMEDOUT' }),
          );
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    if (error instanceof CodexAppServerRpcError && error.code === -32_601) {
      throw Object.assign(new Error('Codex model discovery is not supported'), {
        code: 'unsupported_client',
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
    client.close();
  }
};
