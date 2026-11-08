import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
      healthcheck?: { start_period?: string; test: string[] };
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

describe.each(['deploy', 'dev'])('%s docker-compose rustfs-init', (directory) => {
  const rustfsInit = (
    parse(
      readFileSync(
        path.resolve(import.meta.dirname, '../docker-compose', directory, 'docker-compose.yml'),
        'utf8',
      ),
    ) as { services: Record<string, { command: string }> }
  ).services['rustfs-init'];

  it('lets browsers upload to the bucket through presigned URLs on the RustFS origin', () => {
    // Without a bucket CORS rule RustFS answers the preflight without Access-Control-Allow-*
    // headers, so the browser blocks the presigned PUT and in-chat uploads silently fail.
    const corsStep = rustfsInit.command.match(
      /printf "%s" "(<CORSConfiguration>.*?<\/CORSConfiguration>)" \| rc bucket cors set "rustfs\/lobe" -;/,
    );

    expect(corsStep).not.toBeNull();
    const rule = corsStep![1];
    expect(rule).toContain('<AllowedOrigin>*</AllowedOrigin>');
    for (const method of ['GET', 'PUT', 'HEAD']) {
      expect(rule).toContain(`<AllowedMethod>${method}</AllowedMethod>`);
    }
    expect(rule).toContain('<ExposeHeader>ETag</ExposeHeader>');
  });

  it('applies the CORS rule after the bucket exists', () => {
    expect(rustfsInit.command.indexOf('rc mb "rustfs/lobe"')).toBeLessThan(
      rustfsInit.command.indexOf('rc bucket cors set'),
    );
  });
});

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
    expect(compose.services.lobe.volumes).toContain(
      'fts-search-reindex-state:/app/.elasticsearch-reindex',
    );
    expect(compose.volumes).toHaveProperty('fts-search-reindex-state');
    // The image pre-creates the checkpoint mountpoint so the named volume inherits nextjs ownership.
    expect(dockerfile).toContain('mkdir -p /app/.elasticsearch-reindex');
    expect(compose.services.lobe.environment).toContain(
      'ES_REINDEX_STATE_DIR=/app/.elasticsearch-reindex',
    );

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

  it('keeps in-network URLs on plain HTTP when setup.sh switches to HTTPS', () => {
    const sedExpression =
      "'/^#\\{0,1\\} \\{0,1\\}[A-Za-z0-9_]*=/{/ES_URL=/!{/DEVICE_GATEWAY_URL=/!s|http://|https://|;};}' .env";
    expect(setupScript).toContain(sedExpression);
    // The rewrite must only touch assignments: the warning comment that tells operators not to
    // pair ES_API_KEY with an http:// URL has to keep saying http://.
    for (const envExample of envExamples) {
      const rewritten = envExample
        .split('\n')
        .map((line) =>
          /^#? ?\w*=/.test(line) &&
          !line.includes('ES_URL=') &&
          !line.includes('DEVICE_GATEWAY_URL=')
            ? line.replace('http://', 'https://')
            : line,
        )
        .join('\n');
      expect(rewritten).toContain('# ES_URL=http://elasticsearch:9200\n');
      // The device gateway is reached by the server over the Compose network, never through TLS.
      expect(rewritten).toContain('DEVICE_GATEWAY_URL=http://gateway:8788\n');
      expect(rewritten).toContain('AGENT_GATEWAY_URL=https://localhost:8787\n');
      expect(rewritten).toContain('http:// ');
      expect(rewritten).not.toContain('https:// ');
    }
  });
});

describe('deploy docker-compose first start', () => {
  it('reports PostgreSQL healthy only once it accepts TCP connections', () => {
    // First-time initialization runs a temporary server on the Unix socket only. A socket probe
    // passed there, LobeHub started early, and its migrations failed with ECONNREFUSED until the
    // container had restarted several times.
    const { healthcheck } = compose.services.postgresql;

    expect(healthcheck?.test.join(' ')).toContain('pg_isready -U postgres -h 127.0.0.1');
    expect(healthcheck?.start_period).toBe('60s');
  });

  it('preloads every library the ParadeDB first-start bootstrap needs', () => {
    // The image bootstrap runs CREATE EXTENSION pg_cron under `set -e`. Preloading only pg_search
    // aborted initialization, the container restarted, and the first `docker compose up` failed
    // with "container lobe-postgres is unhealthy" before LobeHub started.
    const preload = compose.services.postgresql
      .command!.find((argument) => argument.startsWith('shared_preload_libraries='))!
      .split('=')[1]
      .split(',');

    expect(preload).toEqual(expect.arrayContaining(['pg_search', 'pg_cron', 'pg_stat_statements']));
  });
});

describe('setup.sh one-click install', () => {
  const awkPath = execFileSync('/bin/sh', ['-c', 'command -v awk'], { encoding: 'utf8' }).trim();

  const extractFunction = (name: string) => {
    const match = setupScript.match(new RegExp(`^${name}\\(\\) \\{\\n[\\s\\S]*?\\n\\}`, 'm'));
    expect(match).not.toBeNull();
    return match![0];
  };

  /** A PATH that holds only the given stubs plus awk, so no host tool can leak into the result. */
  const createStubPath = (stubs: Record<string, string>) => {
    const bin = mkdtempSync(path.join(tmpdir(), 'setup-sh-'));
    for (const [name, body] of Object.entries(stubs)) {
      const file = path.join(bin, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
    }
    symlinkSync(awkPath, path.join(bin, 'awk'));
    return bin;
  };

  const runInBash = (script: string, bin: string) =>
    execFileSync('/bin/bash', ['-c', script], {
      cwd: bin,
      encoding: 'utf8',
      env: { PATH: bin },
    }).trim();

  it('downloads the templates from the branch the released image is built from', () => {
    expect(setupScript).toContain(
      'SOURCE_URL="https://raw.githubusercontent.com/lobehub/lobehub/main"',
    );
  });

  it('detects the host IP with hostname -I on Linux', () => {
    const bin = createStubPath({ hostname: 'echo "10.0.0.5 172.17.0.1"' });

    expect(runInBash(`${extractFunction('detect_host_ip')}\ndetect_host_ip`, bin)).toBe('10.0.0.5');
  });

  it('falls back to the default route source address when hostname -I is unsupported', () => {
    const bin = createStubPath({
      hostname: 'echo "hostname: illegal option -- I" >&2; exit 1',
      ip: 'echo "1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.9 uid 0"',
    });

    expect(runInBash(`${extractFunction('detect_host_ip')}\ndetect_host_ip`, bin)).toBe('10.0.0.9');
  });

  it('detects the host IP on macOS, where hostname -I and ip are unavailable', () => {
    const bin = createStubPath({
      hostname: 'echo "hostname: illegal option -- I" >&2; exit 1',
      ipconfig: '[ "$1" = getifaddr ] && [ "$2" = en0 ] && echo 192.168.1.20',
      route: 'echo "   interface: en0"',
    });

    expect(runInBash(`${extractFunction('detect_host_ip')}\ndetect_host_ip`, bin)).toBe(
      '192.168.1.20',
    );
  });

  it('downloads with curl, which macOS ships, before falling back to wget', () => {
    const downloadFile = extractFunction('download_file');
    const script = `${downloadFile}\ndownload_file https://example.com/file out.txt && echo "$(< out.txt)"`;

    const withCurl = createStubPath({
      curl: 'for last; do :; done; echo curl > "$last"',
      wget: 'echo wget > "$3"',
    });
    expect(runInBash(script, withCurl)).toBe('curl');

    const wgetOnly = createStubPath({ wget: 'echo wget > "$3"' });
    expect(runInBash(script, wgetOnly)).toBe('wget');
  });

  it('generates a matching key pair whose public half carries no private key fields', () => {
    const bin = createStubPath({});
    symlinkSync(process.execPath, path.join(bin, 'node'));

    const output = runInBash(
      `${extractFunction('generate_jwks_key_pair')}\ngenerate_jwks_key_pair`,
      bin,
    );
    const [privateKey, publicKey] = output.split('\n').map((line) => JSON.parse(line).keys[0]);

    expect(privateKey).toMatchObject({ alg: 'RS256', kty: 'RSA' });
    expect(privateKey.d).toBeTruthy();
    for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      expect(publicKey).not.toHaveProperty(field);
    }
    expect(publicKey).toMatchObject({
      alg: 'RS256',
      kid: privateKey.kid,
      kty: 'RSA',
      n: privateKey.n,
    });
  });

  it('passes only the public key to the gateway container', () => {
    const { gateway } = compose.services;

    expect(gateway.environment).toContain('JWKS_PUBLIC_KEY=${JWKS_PUBLIC_KEY:-}');
    expect(gateway.environment?.join('\n')).not.toMatch(/\$\{JWKS_KEY\b/);
    for (const envExample of envExamples) {
      expect(envExample).toContain('JWKS_PUBLIC_KEY=YOUR_JWKS_PUBLIC_KEY\n');
    }
  });
});
