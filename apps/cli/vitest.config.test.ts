import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

import unitConfig from './vitest.config.mts';
import liveConfig from './vitest.e2e.config.mts';

describe('CLI test boundaries', () => {
  it('keeps every live E2E out of the default offline test entry', async () => {
    const unitFiles = await fg(unitConfig.test!.include!);
    const liveFiles = await fg(liveConfig.test!.include!);
    expect(liveFiles).toContain('e2e/memory.e2e.test.ts');
    expect(unitFiles).toContain('tests/agentSignalGolden.test.ts');
    expect(unitFiles).toContain('src/commands/login.test.ts');
    expect(unitFiles).toContain('scripts/ensureWorkspaceLinks.test.ts');
    expect(unitFiles).toContain('tsdown.config.test.ts');
    expect(unitFiles.filter((file) => liveFiles.includes(file))).toEqual([]);
  });

  it('never applies the disposable unit home setup to live tests', () => {
    expect(unitConfig.test!.setupFiles).toEqual(['./tests/setup.ts']);
    expect(liveConfig.test!.setupFiles).toEqual(['./tests/setup.e2e.ts']);
  });
});
