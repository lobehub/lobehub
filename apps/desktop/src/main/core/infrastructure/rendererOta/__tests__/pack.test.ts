import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { sha256File } from '../manifest';
import { decodeRendererPack } from '../pack';

describe('decodeRendererPack', () => {
  it('loads the target tree from a full pack and returns its verified objects', async () => {
    const content = Buffer.from('renderer object');
    const sha256 = sha256File(content);
    const name = `objects/${sha256}`;
    const metadata = {
      kind: 'full',
      packVersion: 1,
      tree: [{ path: 'assets/app.js', sha256, size: content.byteLength }],
      version: 'r1',
    } as const;
    const pack = Buffer.from(
      zipSync({ 'meta.json': Buffer.from(JSON.stringify(metadata)), [name]: content }),
    );

    const decoded = await decodeRendererPack(pack, { kind: 'full', version: 'r1' });
    expect(decoded.metadata).toEqual(metadata);
    expect(decoded.entries.get(name)).toEqual(content);
  });

  it('loads delta reconstruction metadata from the selected pack', async () => {
    const content = Buffer.from('next renderer object');
    const sha256 = sha256File(content);
    const name = `objects/${sha256}`;
    const metadata = {
      fromVersion: 'r0',
      kind: 'delta',
      objects: [sha256],
      packVersion: 1,
      patches: [],
      tree: [{ path: 'assets/app.js', sha256, size: content.byteLength }],
      version: 'r1',
    } as const;
    const pack = Buffer.from(
      zipSync({ 'meta.json': Buffer.from(JSON.stringify(metadata)), [name]: content }),
    );

    const decoded = await decodeRendererPack(pack, {
      fromVersion: 'r0',
      kind: 'delta',
      version: 'r1',
    });
    expect(decoded.metadata).toEqual(metadata);
    expect(decoded.entries.get(name)).toEqual(content);
  });

  it('rejects unexpected, tampered, or path-traversing pack content', async () => {
    const content = Buffer.from('renderer object');
    const sha256 = sha256File(content);
    const name = `objects/${sha256}`;
    const metadata = {
      kind: 'full',
      packVersion: 1,
      tree: [{ path: 'assets/app.js', sha256, size: content.byteLength }],
      version: 'r1',
    } as const;
    const encodedMetadata = Buffer.from(JSON.stringify(metadata));

    await expect(
      decodeRendererPack(Buffer.from(zipSync({ 'extra': content, 'meta.json': encodedMetadata })), {
        kind: 'full',
        version: 'r1',
      }),
    ).rejects.toThrow('entries do not match metadata');
    await expect(
      decodeRendererPack(
        Buffer.from(zipSync({ [name]: Buffer.from('tampered'), 'meta.json': encodedMetadata })),
        { kind: 'full', version: 'r1' },
      ),
    ).rejects.toThrow(`pack entry invalid: ${name}`);

    await expect(
      decodeRendererPack(
        Buffer.from(
          zipSync({
            [name]: content,
            'meta.json': Buffer.from(
              JSON.stringify({
                ...metadata,
                tree: [{ ...metadata.tree[0], path: '../app.js' }],
              }),
            ),
          }),
        ),
        { kind: 'full', version: 'r1' },
      ),
    ).rejects.toThrow('pack metadata invalid');
  });
});
