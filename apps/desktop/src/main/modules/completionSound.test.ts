import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import pathUtils from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCompletionSoundImport } from './completionSound';

describe('completion sound import', () => {
  let directory: string;
  const audio = Buffer.from('RIFF0000WAVEfmt ');
  const manifest = (file = 'done.wav', sha256?: string) =>
    JSON.stringify({
      categories: { 'task.complete': { sounds: [{ file, sha256 }] } },
      cesp_version: '1.0',
      display_name: 'Test pack',
    });

  beforeEach(async () => {
    directory = await mkdtemp(pathUtils.join(tmpdir(), 'completion-sound-test-'));
    await writeFile(pathUtils.join(directory, 'done.wav'), audio);
  });
  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('loads standalone audio and OpenPeon completion audio', async () => {
    expect(await readCompletionSoundImport(pathUtils.join(directory, 'done.wav'))).toMatchObject({
      name: 'done.wav',
      sounds: [{ data: audio, mime: 'audio/wav' }],
    });
    await writeFile(pathUtils.join(directory, 'openpeon.json'), manifest());
    expect(
      await readCompletionSoundImport(pathUtils.join(directory, 'openpeon.json')),
    ).toMatchObject({
      name: 'Test pack',
      sounds: [{ data: audio }],
    });
  });

  it('rejects traversal and symlinks outside the selected pack', async () => {
    const pack = pathUtils.join(directory, 'pack');
    await mkdir(pack);
    await writeFile(pathUtils.join(pack, 'openpeon.json'), manifest('../done.wav'));
    await expect(readCompletionSoundImport(pathUtils.join(pack, 'openpeon.json'))).rejects.toThrow(
      'Invalid sound path',
    );
    await symlink(pathUtils.join(directory, 'done.wav'), pathUtils.join(pack, 'done.wav'));
    await writeFile(pathUtils.join(pack, 'openpeon.json'), manifest());
    await expect(readCompletionSoundImport(pathUtils.join(pack, 'openpeon.json'))).rejects.toThrow(
      'escapes pack',
    );
  });

  it('rejects disguised audio, oversize files and checksum mismatches', async () => {
    await writeFile(pathUtils.join(directory, 'bad.mp3'), 'this is not audio');
    await expect(readCompletionSoundImport(pathUtils.join(directory, 'bad.mp3'))).rejects.toThrow(
      'Unsupported audio',
    );
    await writeFile(pathUtils.join(directory, 'large.wav'), Buffer.alloc(1024 * 1024 + 1));
    await expect(readCompletionSoundImport(pathUtils.join(directory, 'large.wav'))).rejects.toThrow(
      'size limit',
    );
    await writeFile(
      pathUtils.join(directory, 'openpeon.json'),
      manifest('done.wav', '0'.repeat(64)),
    );
    await expect(
      readCompletionSoundImport(pathUtils.join(directory, 'openpeon.json')),
    ).rejects.toThrow('checksum');
  });

  it('rejects packs without completion sounds without falling back to other events', async () => {
    await writeFile(
      pathUtils.join(directory, 'openpeon.json'),
      JSON.stringify({
        categories: { 'session.end': { sounds: [{ file: 'done.wav' }] } },
        cesp_version: '1.0',
        display_name: 'Wrong event',
      }),
    );
    await expect(
      readCompletionSoundImport(pathUtils.join(directory, 'openpeon.json')),
    ).rejects.toThrow();
  });
});
