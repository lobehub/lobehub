import { existsSync, type FSWatcher, readFileSync, watch } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

/**
 * Only restart the dev server when whitelisted env keys change,
 * instead of restarting on every .env file modification.
 *
 * Respects Vite's env loading order:
 *   .env → .env.local → .env.[mode] → .env.[mode].local
 */
export function viteEnvRestartKeys(keys: string[]): Plugin {
  let mode: string;
  let envDir: string;
  let prevSnapshot: Record<string, string | undefined>;
  let dirWatcher: FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function getEnvFileNames(): Set<string> {
    return new Set(['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`]);
  }

  /**
   * Parse env files directly from disk (bypassing process.env override in loadEnv).
   * Later files override earlier ones, matching Vite's precedence.
   */
  function parseEnvFromDisk(): Record<string, string> {
    const files = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`].map((f) =>
      path.join(envDir, f),
    );

    const result: Record<string, string> = {};
    for (const file of files) {
      if (!existsSync(file)) continue;
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        // strip surrounding quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        result[key] = value;
      }
    }
    return result;
  }

  function snapshot(): Record<string, string | undefined> {
    const env = parseEnvFromDisk();
    const snap: Record<string, string | undefined> = {};
    for (const key of keys) {
      snap[key] = env[key];
    }
    return snap;
  }

  function hasChanges(next: Record<string, string | undefined>): string[] {
    const changed: string[] = [];
    for (const key of keys) {
      if (prevSnapshot[key] !== next[key]) changed.push(key);
    }
    return changed;
  }

  return {
    name: 'vite-env-restart-keys',
    apply: 'serve',

    config() {
      return {
        server: {
          watch: {
            ignored: ['**/.env', '**/.env.*'],
          },
        },
      };
    },

    configResolved(config) {
      mode = config.mode;
      envDir = config.envDir || config.root;
      prevSnapshot = snapshot();
    },

    configureServer(server) {
      dirWatcher?.close();

      const envFileNames = getEnvFileNames();

      dirWatcher = watch(envDir, (_event, filename) => {
        if (!filename || !envFileNames.has(filename)) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const next = snapshot();
          const changed = hasChanges(next);
          prevSnapshot = next;
          if (changed.length > 0) {
            server.config.logger.info(
              `env key changed: ${changed.join(', ')} — restarting server`,
              { timestamp: true },
            );
            server.restart();
          }
        }, 100);
      });

      server.httpServer?.on('close', () => {
        dirWatcher?.close();
        dirWatcher = null;
        if (debounceTimer) clearTimeout(debounceTimer);
      });
    },
  };
}
