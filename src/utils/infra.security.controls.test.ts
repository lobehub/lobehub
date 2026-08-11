import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * AICO-109 — regression guards for infrastructure defaults fixed in Phase 4.
 * Defensive source assertions only (no exploit payloads / scanners).
 */
describe('infra security controls (AICO-109)', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

  const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

  it('dockerignores env files so COPY . cannot bake secrets', () => {
    const dockerignore = read('.dockerignore');
    expect(dockerignore).toMatch(/^\.env$/m);
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
  });

  it('runs Aico/local Docker images as non-root nextjs', () => {
    expect(read('Dockerfile.prebuilt')).toContain('USER nextjs');
    expect(read('scripts/docker/Dockerfile.staged')).toContain('USER nextjs');
    expect(read('apps/aico-control-plane/Dockerfile')).toContain('USER nextjs');
    expect(read('Dockerfile')).toContain('USER nextjs');
  });

  it('does not disable TLS verification in the production Dockerfile', () => {
    expect(read('Dockerfile')).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
  });

  it('does not publish Postgres/Redis host ports in deploy compose by default', () => {
    const compose = read('docker-compose/deploy/docker-compose.yml');
    expect(compose).not.toMatch(/^\s*-\s*['"]5432:5432['"]/m);
    expect(compose).not.toMatch(/^\s*-\s*['"]6379:6379['"]/m);
  });

  it('avoids floating @main for actions-cool/pr-welcome', () => {
    const workflow = read('.github/workflows/issue-auto-comments.yml');
    expect(workflow).not.toContain('actions-cool/pr-welcome@main');
    expect(workflow).not.toContain('actions-cool/pr-welcome@');
  });

  it('keeps deploy env examples free of concrete postgres passwords', () => {
    expect(read('docker-compose/deploy/.env.example')).not.toContain('uWNZugjBqixf8dxC');
    expect(read('docker-compose/production/grafana/.env.example')).not.toContain(
      'uWNZugjBqixf8dxC',
    );
  });
});
