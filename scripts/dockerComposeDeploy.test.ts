import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const deployDirectory = path.resolve(import.meta.dirname, '../docker-compose/deploy');
const compose = parse(readFileSync(path.join(deployDirectory, 'docker-compose.yml'), 'utf8')) as {
  services: Record<
    string,
    {
      build?: { args?: Record<string, string>; context?: string };
      command?: string[];
      depends_on?: Record<string, { condition: string }>;
      entrypoint?: string[];
      environment?: string[];
      healthcheck?: { test: string[] };
      image: string;
      ports?: string[];
      profiles?: string[];
      restart?: string;
      stop_grace_period?: string;
      volumes?: string[];
    }
  >;
  volumes: Record<string, unknown>;
};
const dockerfile = readFileSync(path.resolve(import.meta.dirname, '../Dockerfile'), 'utf8');
const elasticsearchDockerfile = readFileSync(
  path.join(deployDirectory, 'elasticsearch/Dockerfile'),
  'utf8',
);
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

  it('keeps the backfill and sync services usable against an external Elasticsearch', () => {
    // Only the `elasticsearch` profile starts the bundled node. `docker compose run` starts
    // dependencies, so a `depends_on: elasticsearch` here would build and start the local node
    // even when .env points at an external Elastic Cloud target.
    expect(elasticsearch.profiles).toEqual(['elasticsearch']);
    for (const service of [reindex, sync]) {
      expect(service.depends_on).not.toHaveProperty('elasticsearch');
      expect(service.depends_on?.postgresql.condition).toBe('service_healthy');
    }
  });

  it('builds a pinned official single-node image with ICU, persistence, and a health check', () => {
    // A checked-in Dockerfile keeps the Compose file parseable by older Compose releases;
    // `dockerfile_inline` would be rejected at parse time even with the profile disabled.
    expect(elasticsearch.build).toEqual({
      args: { ELASTICSEARCH_VERSION: expect.stringMatching(/^\d+\.\d+\.\d+$/) },
      context: './elasticsearch',
    });
    const version = elasticsearch.build!.args!.ELASTICSEARCH_VERSION;
    // The local tag carries the same version so bumping it triggers a rebuild on `up`.
    expect(elasticsearch.image).toBe(`lobehub-elasticsearch-icu:${version}`);
    expect(elasticsearchDockerfile).toContain(
      'FROM docker.elastic.co/elasticsearch/elasticsearch:${ELASTICSEARCH_VERSION}',
    );
    expect(elasticsearchDockerfile).toContain(
      'RUN bin/elasticsearch-plugin install --batch analysis-icu',
    );
    // The one-click installer must download the build context next to the Compose file.
    expect(setupScript).toContain('"$SUB_DIR/elasticsearch/Dockerfile"');
    expect(setupScript).toContain('"elasticsearch/Dockerfile"');
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
    // Compose's default 10s grace period would SIGKILL a drain step in flight.
    expect(sync.stop_grace_period).toBe('2m');
    // The sync bundle keeps drizzle-orm external, and drizzle-orm/neon-serverless requires
    // @neondatabase/serverless at load time even though DATABASE_DRIVER=node never uses it, so the
    // image must ship that package next to pg and drizzle-orm or the container crash-loops.
    expect(dockerfile).toContain('pnpm add pg drizzle-orm @neondatabase/serverless');
    expect(dockerfile).toContain(
      'COPY --from=builder /deps/node_modules/@neondatabase /app/node_modules/@neondatabase',
    );
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
    const sedExpression =
      "'/^#\\{0,1\\} \\{0,1\\}[A-Za-z0-9_]*=/{/ES_URL=/!s|http://|https://|;}' .env";
    expect(setupScript).toContain(sedExpression);
    // The rewrite must only touch assignments: the warning comment that tells operators not to
    // pair ES_API_KEY with an http:// URL has to keep saying http://.
    for (const envExample of envExamples) {
      const rewritten = envExample
        .split('\n')
        .map((line) =>
          /^#? ?\w*=/.test(line) && !line.includes('ES_URL=')
            ? line.replace('http://', 'https://')
            : line,
        )
        .join('\n');
      expect(rewritten).toContain('# ES_URL=http://elasticsearch:9200\n');
      expect(rewritten).toContain('http:// ');
      expect(rewritten).not.toContain('https:// ');
    }
  });
});
