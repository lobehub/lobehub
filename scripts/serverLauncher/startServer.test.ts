import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

const launcher = path.join(import.meta.dirname, 'startServer.js');

/** Exercise the real launcher with child processes replaced by deterministic exits. */
const launch = async (env: Record<string, string>, failure?: { code: number; script: string }) => {
  const commands: string[][] = [];
  const exits: number[] = [];
  const source = await readFile(launcher, 'utf8');
  const modules: Record<string, unknown> = {
    'node:child_process': {
      spawn: (executable: string, args: string[]) => {
        commands.push([executable, ...args]);
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('close', args[0] === failure?.script ? failure.code : 0));
        return child;
      },
    },
    'node:dns': { promises: { getServers: () => [] } },
    'node:fs': { existsSync: () => true, promises: { access: async () => undefined } },
    'node:path': { join: (...parts: string[]) => parts.join('/') },
  };
  await vm
    .runInNewContext(source, {
      __dirname: '/app',
      console: { error: () => undefined, log: () => undefined, warn: () => undefined },
      process: {
        env,
        exit: (code: number) => {
          exits.push(code);
          throw new Error('launcher exited');
        },
      },
      require: (name: string) => modules[name] ?? { checkDeprecatedAuth: () => undefined },
    })
    .catch((error: Error) => {
      if (error.message !== 'launcher exited') throw error;
    });
  return { commands, exits };
};

describe('Docker startup migrations', () => {
  it('finishes PostgreSQL and Elasticsearch migrations before serving requests', async () => {
    const result = await launch({ DATABASE_DRIVER: 'node', FTS_SEARCH_PROVIDER: 'elasticsearch' });
    expect(result.commands).toEqual([
      ['/bin/node', '/app/docker.cjs'],
      ['/bin/node', '/app/fts-search-elasticsearch-reindex.cjs', '--startup', '--yes'],
      ['/bin/node', '/app/server.js'],
    ]);
    expect(result.exits).toEqual([]);
  });

  it('runs PostgreSQL first for Elasticsearch even without an explicit driver', async () => {
    const result = await launch({ FTS_SEARCH_PROVIDER: 'elasticsearch' });
    expect(result.commands.map((command) => command[1])).toEqual([
      '/app/docker.cjs',
      '/app/fts-search-elasticsearch-reindex.cjs',
      '/app/server.js',
    ]);
  });

  it('supplies the migration telemetry environment when Docker telemetry is enabled', async () => {
    const result = await launch({
      ENABLE_TELEMETRY: '1',
      FTS_SEARCH_PROVIDER: 'elasticsearch',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
    });
    expect(result.commands).toEqual([
      ['/bin/node', '/app/docker.cjs'],
      [
        '/bin/node',
        '/app/fts-search-elasticsearch-reindex.cjs',
        '--startup',
        '--yes',
        '--telemetry-environment=production',
      ],
      ['/bin/node', '/app/server.js'],
    ]);
    expect(result.exits).toEqual([]);
  });

  it('keeps PostgreSQL-only startup free of Elasticsearch operations', async () => {
    const result = await launch({ DATABASE_DRIVER: 'node', FTS_SEARCH_PROVIDER: 'pg_search' });
    expect(result.commands.map((command) => command[1])).toEqual([
      '/app/docker.cjs',
      '/app/server.js',
    ]);
  });

  it.each(['/app/docker.cjs', '/app/fts-search-elasticsearch-reindex.cjs'])(
    'does not serve requests when %s fails',
    async (script) => {
      const result = await launch(
        { DATABASE_DRIVER: 'node', FTS_SEARCH_PROVIDER: 'elasticsearch' },
        { code: 1, script },
      );
      expect(result.commands.some((command) => command[1] === '/app/server.js')).toBe(false);
      expect(result.exits).toEqual([1]);
    },
  );
});
