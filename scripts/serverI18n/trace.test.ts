import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, it } from 'vitest';

import { auditFunctionTrace } from './trace';

it('counts trace files once and rejects locale modules embedded in indexed source maps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'i18n-trace-'));
  try {
    const manifest = path.join(root, 'route.js.nft.json');
    await writeFile(path.join(root, 'route.js'), 'entry');
    await writeFile(path.join(root, 'chunk.js'), 'chunk');
    await writeFile(manifest, JSON.stringify({ files: ['chunk.js', 'chunk.js'] }));
    expect(await auditFunctionTrace(manifest)).toEqual({ bytes: 10, files: 2, sourceMaps: 0 });
    await writeFile(
      path.join(root, 'chunk.js.map'),
      JSON.stringify({
        sections: [{ map: { sources: ['turbopack:///[project]/locales/zh-CN/models.json'] } }],
      }),
    );
    await expect(auditFunctionTrace(manifest)).rejects.toThrow('Unprojected locale embedded');
    await mkdir(path.join(root, 'locales/en-US'), { recursive: true });
    await writeFile(path.join(root, 'locales/en-US/models.json'), '{}');
    await writeFile(manifest, JSON.stringify({ files: ['locales/en-US/models.json'] }));
    await expect(auditFunctionTrace(manifest)).rejects.toThrow('Unprojected locale in NFT');
    await mkdir(path.join(root, 'src/libs/i18n/server/generated'), { recursive: true });
    const report = 'src/libs/i18n/server/generated/report.json';
    await writeFile(path.join(root, report), '{}');
    await writeFile(manifest, JSON.stringify({ files: [report] }));
    await expect(auditFunctionTrace(manifest)).rejects.toThrow('Build-only i18n report in NFT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
