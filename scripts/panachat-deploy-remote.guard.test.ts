// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('control-plane CI/CD wiring', () => {
  it('builds and deploys a GHCR control-plane image on canary and preview', () => {
    const canary = read('.github/workflows/deploy-canary.yml');
    const preview = read('.github/workflows/deploy-preview.yml');

    for (const yaml of [canary, preview]) {
      expect(yaml).toContain('build-control-plane:');
      expect(yaml).toContain('file: ./apps/aico-control-plane/Dockerfile');
      expect(yaml).toContain('PANACHAT_CONTROL_PLANE_IMAGE');
      expect(yaml).toContain('needs: [build, build-control-plane]');
    }
  });

  it('recreates the control-plane container without compose down -v', () => {
    const script = read('scripts/panachat-deploy-remote.sh');
    const compose = read('docker-compose/deploy/docker-compose.panachat.yml');
    const dockerfile = read('apps/aico-control-plane/Dockerfile');

    expect(script).toContain('deploy_control_plane');
    expect(script).toMatch(
      /compose_with_profile control-plane up -d --no-deps --force-recreate panachat-control-plane/,
    );
    expect(script).not.toMatch(/^\s*(docker compose|compose).*down\s+-v/m);

    expect(compose).not.toMatch(
      /panachat-control-plane:[\s\S]*?volumes:[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]*\n\s*-\s+\.\.:\/app/,
    );
    expect(compose).toContain('S3_INTERNAL_ENDPOINT=http://rustfs:9000');
    expect(compose).toContain('RUSTFS_CORS_ALLOWED_ORIGINS=${RUSTFS_CORS_ALLOWED_ORIGINS:-*}');
    expect(compose).toContain('pull_policy: always');

    expect(dockerfile).toContain('pnpm run build:spa:control-plane');
    expect(dockerfile).toContain('pnpm --filter @aico/control-plane build');
    expect(dockerfile).toContain('CMD ["node", "dist/standalone.js"]');
    expect(dockerfile).toContain('Do not bind-mount');
    expect(dockerfile).not.toMatch(/pnpm i[^\n]*--frozen-lockfile/);
    expect(dockerfile).not.toMatch(/--config\.dangerouslyAllowAllBuilds/);
  });

  it('prints moz-like status (users, health) and deploys chat even if control-plane build fails', () => {
    const script = read('scripts/panachat-deploy-remote.sh');
    const canary = read('.github/workflows/deploy-canary.yml');
    const preview = read('.github/workflows/deploy-preview.yml');

    expect(script).toContain('echo "Users:');
    expect(script).toContain('Platform admins:');
    expect(script).toContain('FROM platform_admin_users');
    expect(script).toContain('Control plane /health');

    for (const yaml of [canary, preview]) {
      expect(yaml).toContain("always() && needs.build.result == 'success'");
      expect(yaml).toContain('cancel-in-progress: true');
      expect(yaml).toContain('cancel-in-progress: false');
    }
    expect(canary).toContain('group: deploy-canary-ssh');
    expect(preview).toContain('group: deploy-preview-ssh');
  });

  it('configures S3 CORS so browser chat-image PUT is not blocked', () => {
    const compose = read('docker-compose/deploy/docker-compose.panachat.yml');
    const nginx = read('docker-compose/deploy/nginx/panachat-s3-site.example.conf');

    expect(compose).toContain('RUSTFS_CORS_ALLOWED_ORIGINS=${RUSTFS_CORS_ALLOWED_ORIGINS:-*}');
    expect(nginx).toContain('Access-Control-Allow-Origin');
    expect(nginx).toContain('proxy_hide_header Access-Control-Allow-Origin');
    expect(nginx).toContain('return 204');
    expect(nginx).toContain('not object authorization');
  });

  it('keeps the S3 bucket private so raw object URLs are not world-readable', () => {
    const compose = read('docker-compose/deploy/docker-compose.panachat.yml');
    const deployCompose = read('docker-compose/deploy/docker-compose.yml');
    const bucket = JSON.parse(read('docker-compose/deploy/bucket.config.json')) as {
      Statement: unknown[];
    };

    expect(compose).toContain('mc anonymous set none "rustfs/lobe"');
    expect(compose).not.toContain('mc anonymous set-json');
    expect(deployCompose).toContain('mc anonymous set none "rustfs/lobe"');
    expect(bucket.Statement).toEqual([]);
  });
});
