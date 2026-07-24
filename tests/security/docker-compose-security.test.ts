import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('docker-compose security defaults', () => {
  it('does not expose Postgres or Redis on all host interfaces by default', () => {
    const composeFiles = [
      'docker-compose/deploy/docker-compose.yml',
      'docker-compose/dev/docker-compose.yml',
      'docker-compose/production/grafana/docker-compose.yml',
    ];

    for (const file of composeFiles) {
      const content = read(file);

      expect(content, file).not.toContain("'5432:5432'");
      expect(content, file).not.toContain('"5432:5432"');
      expect(content, file).not.toContain("'6379:6379'");
      expect(content, file).not.toContain('"6379:6379"');
    }
  });

  it('requires generated SearXNG secrets instead of a committed shared key', () => {
    const knownSharedSecret = '779c5b69fe650f147be9012abca6b44a8697acdb2817b46353f4779bb07d81d1';
    const files = [
      'docker-compose/deploy/docker-compose.yml',
      'docker-compose/deploy/searxng-settings.yml',
      'docker-compose/dev/docker-compose.yml',
      'docker-compose/dev/searxng-settings.yml',
      'docker-compose/production/grafana/docker-compose.yml',
      'docker-compose/production/grafana/searxng-settings.yml',
      'docker-compose/setup.sh',
    ];

    for (const file of files) {
      expect(read(file), file).not.toContain(knownSharedSecret);
    }

    expect(read('docker-compose/setup.sh')).toContain('SEARXNG_SECRET=$(openssl rand -hex 32)');
    expect(read('docker-compose/deploy/docker-compose.yml')).toContain(
      '${SEARXNG_SECRET:?SEARXNG_SECRET must be set}',
    );
  });
});
