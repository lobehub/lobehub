import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const deployDirectory = path.resolve(import.meta.dirname, '../docker-compose/deploy');
const compose = parse(readFileSync(path.join(deployDirectory, 'docker-compose.yml'), 'utf8')) as {
  services: Record<
    string,
    {
      build?: { dockerfile_inline?: string };
      command?: string[];
      depends_on?: Record<string, { condition: string }>;
      entrypoint?: string[];
      environment?: string[];
      healthcheck?: { test: string[] };
      image: string;
      ports?: string[];
      profiles?: string[];
      restart?: string;
      volumes?: string[];
    }
  >;
  volumes: Record<string, unknown>;
};
const dockerfile = readFileSync(path.resolve(import.meta.dirname, '../Dockerfile'), 'utf8');
const setupScript = readFileSync(path.join(deployDirectory, '../setup.sh'), 'utf8');
const envExamples = ['.env.example', '.env.zh-CN.example'].map((file) =>
  readFileSync(path.join(deployDirectory, file), 'utf8'),
);

const ELASTICSEARCH_PROFILES = ['elasticsearch', 'elasticsearch-reindex', 'elasticsearch-sync'];

describe('deploy docker-compose optional Elasticsearch', () => {
  const {
    elasticsearch,
    'fts-search-reindex': reindex,
    'fts-search-sync': sync,
  } = compose.services;

  it('keeps every Elasticsearch service behind an opt-in profile so the default deployment is unchanged', () => {
    const profiled = Object.entries(compose.services).filter(([, service]) => service.profiles);
    expect(profiled.map(([name]) => name).sort()).toEqual([
      'elasticsearch',
      'fts-search-reindex',
      'fts-search-sync',
    ]);
    for (const [, service] of profiled) {
      expect(service.profiles!.every((profile) => ELASTICSEARCH_PROFILES.includes(profile))).toBe(
        true,
      );
    }
    expect(compose.services.lobe.depends_on).not.toHaveProperty('elasticsearch');
  });

  it('makes the Elasticsearch node available to every profile that depends on it', () => {
    expect(elasticsearch.profiles).toEqual(ELASTICSEARCH_PROFILES);
    expect(reindex.depends_on?.elasticsearch.condition).toBe('service_healthy');
    expect(sync.depends_on?.elasticsearch.condition).toBe('service_healthy');
    for (const service of [reindex, sync]) {
      for (const profile of service.profiles!) expect(elasticsearch.profiles).toContain(profile);
    }
  });

  it('builds a pinned official single-node image with ICU, persistence, and a health check', () => {
    const inlineDockerfile = elasticsearch.build?.dockerfile_inline ?? '';
    const from = inlineDockerfile.match(
      /^FROM docker\.elastic\.co\/elasticsearch\/elasticsearch:(\d+\.\d+\.\d+)$/m,
    );
    expect(from).not.toBeNull();
    // The local tag carries the same version so bumping it triggers a rebuild on `up`.
    expect(elasticsearch.image).toBe(`lobehub-elasticsearch-icu:${from![1]}`);
    expect(inlineDockerfile).toContain('RUN bin/elasticsearch-plugin install --batch analysis-icu');
    // No runtime plugin install: the entrypoint of the official image stays untouched.
    expect(elasticsearch.command).toBeUndefined();
    expect(elasticsearch.entrypoint).toBeUndefined();
    expect(elasticsearch.environment).toContain('discovery.type=single-node');
    expect(elasticsearch.environment).toContain('xpack.security.enabled=false');
    expect(elasticsearch.environment?.some((entry) => entry.startsWith('ES_JAVA_OPTS='))).toBe(
      true,
    );
    expect(elasticsearch.volumes).toContain('elasticsearch-data:/usr/share/elasticsearch/data');
    expect(compose.volumes).toHaveProperty('elasticsearch-data');
    expect(elasticsearch.healthcheck?.test.join(' ')).toContain('/_cluster/health');
  });

  it('never publishes the unauthenticated Elasticsearch port to the host', () => {
    expect(elasticsearch.ports).toBeUndefined();
    expect(reindex.ports).toBeUndefined();
    expect(sync.ports).toBeUndefined();
  });

  it('runs backfill and continuous sync from the official LobeHub image', () => {
    expect(reindex.image).toBe('lobehub/lobehub');
    expect(reindex.restart).toBe('no');
    // The image ENTRYPOINT is `/bin/node`, and `docker compose run <service> <args>` replaces the
    // whole command, so the script must live in the entrypoint for `run ... --apply` to work.
    expect(reindex.entrypoint).toEqual(['/bin/node', '/app/fts-search-elasticsearch-reindex.cjs']);
    expect(reindex.command).toEqual(['--status']);
    expect(reindex.environment).toContain('ES_REINDEX_STATE_DIR=/app/.elasticsearch-reindex');
    expect(reindex.volumes).toContain('fts-search-reindex-state:/app/.elasticsearch-reindex');
    expect(compose.volumes).toHaveProperty('fts-search-reindex-state');
    // The image pre-creates the checkpoint mountpoint so the named volume inherits nextjs ownership.
    expect(dockerfile).toContain('mkdir -p /app/.elasticsearch-reindex');

    expect(sync.image).toBe('lobehub/lobehub');
    expect(sync.restart).toBe('always');
    expect(sync.entrypoint).toEqual(['/bin/node', '/app/fts-search-elasticsearch-sync.cjs']);
    expect(sync.command).toEqual([
      '--max-steps=8',
      '--interval-seconds=${FTS_SEARCH_SYNC_INTERVAL_SECONDS:-15}',
      '--yes',
    ]);
    expect(sync.environment).toContain('FTS_SEARCH_SYNC_ENABLED=true');
    expect(sync.environment).toContain('MIGRATION_DB=1');
  });

  it('never switches the search provider on behalf of the operator', () => {
    for (const service of [elasticsearch, reindex, sync, compose.services.lobe]) {
      expect(
        service.environment?.some((entry) => entry.startsWith('FTS_SEARCH_PROVIDER=')),
      ).toBeFalsy();
    }
    for (const envExample of envExamples) {
      expect(envExample).not.toMatch(/^FTS_SEARCH_PROVIDER=/m);
    }
  });

  it('documents the explicit insecure in-network mode in both env examples without exposing a key', () => {
    for (const envExample of envExamples) {
      expect(envExample).toContain('# COMPOSE_PROFILES=elasticsearch\n');
      expect(envExample).toContain('# COMPOSE_PROFILES=elasticsearch,elasticsearch-sync\n');
      expect(envExample).toContain('# ES_URL=http://elasticsearch:9200\n');
      expect(envExample).toContain('# ES_ALLOW_INSECURE_HTTP=true\n');
      expect(envExample).toContain('# ES_INDEX_NAMESPACE=lobehub\n');
      expect(envExample).not.toMatch(/^#?\s*ES_API_KEY=/m);
      // Every optional line stays commented so the default deployment ignores the whole block.
      expect(envExample).not.toMatch(/^(COMPOSE_PROFILES|ES_[A-Z_]+)=/m);
    }
  });

  it('keeps the in-network Elasticsearch URL on plain HTTP when setup.sh switches to HTTPS', () => {
    expect(setupScript).toContain('"/ES_URL=/! s#http://#https://#" .env');
  });
});
