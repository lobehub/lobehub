import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { computeMainHash, STANDALONE_FILES } from '../mainHash.mjs';

const desktopRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const repoRoot = path.dirname(path.dirname(desktopRoot));

describe('mainHash', () => {
  it('only hashes git-tracked standalone files so CI fresh checkouts reproduce the hash', () => {
    for (const file of STANDALONE_FILES) {
      const abs = path.join(desktopRoot, file);
      expect(
        () => execFileSync('git', ['ls-files', '--error-unmatch', abs], { cwd: repoRoot }),
        `${file} must be committed — untracked inputs are silently skipped on fresh checkouts`,
      ).not.toThrow();
    }
  });

  it('changes when a file under src/common changes', () => {
    const probe = path.join(desktopRoot, 'src', 'common', `__mainhash-probe-${randomUUID()}.ts`);
    const before = computeMainHash();
    writeFileSync(probe, 'export const probe = 1;\n');
    try {
      expect(computeMainHash()).not.toBe(before);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it('changes when a main-process locale resource changes', () => {
    const probe = path.join(
      desktopRoot,
      'resources',
      'locales',
      `__mainhash-probe-${randomUUID()}.json`,
    );
    const before = computeMainHash();
    writeFileSync(probe, '{}\n');
    try {
      expect(computeMainHash()).not.toBe(before);
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it('changes when the Cloud build revision changes', () => {
    const originalCloudRef = process.env.CLOUD_REF;
    try {
      process.env.CLOUD_REF = 'a'.repeat(40);
      const before = computeMainHash();
      process.env.CLOUD_REF = 'b'.repeat(40);
      expect(computeMainHash()).not.toBe(before);
    } finally {
      if (originalCloudRef === undefined) delete process.env.CLOUD_REF;
      else process.env.CLOUD_REF = originalCloudRef;
    }
  });

  it('starts a new lineage for each release version and verification key', () => {
    const packagePath = path.join(desktopRoot, 'package.json');
    const originalPackage = readFileSync(packagePath, 'utf8');
    const originalPublicKey = process.env.RENDERER_OTA_PUBLIC_KEY;
    try {
      process.env.RENDERER_OTA_PUBLIC_KEY = 'key-a';
      const before = computeMainHash();
      const packageJson = JSON.parse(originalPackage);
      packageJson.version = '99.0.0-beta.1';
      writeFileSync(packagePath, JSON.stringify(packageJson, null, 2));
      const nextRelease = computeMainHash();
      expect(nextRelease).not.toBe(before);

      process.env.RENDERER_OTA_PUBLIC_KEY = 'key-b';
      expect(computeMainHash()).not.toBe(nextRelease);
    } finally {
      writeFileSync(packagePath, originalPackage);
      if (originalPublicKey === undefined) delete process.env.RENDERER_OTA_PUBLIC_KEY;
      else process.env.RENDERER_OTA_PUBLIC_KEY = originalPublicKey;
    }
  });
});
