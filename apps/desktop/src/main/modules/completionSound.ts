import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import pathUtils from 'node:path';

import { z } from 'zod';

const MAX_SOUND_BYTES = 1024 * 1024;
const MAX_PACK_BYTES = 50 * MAX_SOUND_BYTES;

const packSchema = z.object({
  categories: z.object({
    'task.complete': z.object({
      sounds: z
        .array(
          z.object({
            file: z.string().min(1),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/i)
              .optional(),
          }),
        )
        .min(1)
        .max(200),
    }),
  }),
  cesp_version: z.literal('1.0'),
  display_name: z.string().min(1).max(128),
});

const readBoundedFile = async (path: string, maxBytes: number) => {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) throw new Error('Sound file exceeds size limit');
  const data = await readFile(path);
  if (data.length > maxBytes) throw new Error('Sound file exceeds size limit');
  return data;
};

const readSound = async (path: string) => {
  const data = await readBoundedFile(path, MAX_SOUND_BYTES);
  const extension = pathUtils.extname(path).toLowerCase();
  const header = data.toString('ascii', 0, 4);
  let mime: string | undefined;
  if (extension === '.wav' && header === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE')
    mime = 'audio/wav';
  if (extension === '.ogg' && header === 'OggS') mime = 'audio/ogg';
  if (
    extension === '.mp3' &&
    (data.toString('ascii', 0, 3) === 'ID3' || (data[0] === 0xff && (data[1] & 0xe0) === 0xe0))
  )
    mime = 'audio/mpeg';
  if (!mime) throw new Error('Unsupported audio file');
  return { data, extension, mime };
};

/** Import only task.complete audio; never execute scripts supplied by a sound pack. */
export const readCompletionSoundImport = async (path: string) => {
  if (pathUtils.extname(path).toLowerCase() !== '.json') {
    return { name: pathUtils.basename(path), sounds: [await readSound(path)] };
  }

  if (pathUtils.basename(path) !== 'openpeon.json') throw new Error('Select openpeon.json');
  const manifest = packSchema.parse(
    JSON.parse((await readBoundedFile(path, MAX_SOUND_BYTES)).toString('utf8')),
  );
  const root = await realpath(pathUtils.dirname(path));
  const sounds: Awaited<ReturnType<typeof readSound>>[] = [];
  let bytes = 0;
  for (const entry of manifest.categories['task.complete'].sounds) {
    if (
      entry.file.split('/').some((part) => !/^[\w.-]+$/.test(part) || part === '..' || part === '.')
    )
      throw new Error('Invalid sound path');
    const source = await realpath(pathUtils.resolve(root, entry.file));
    const withinRoot = pathUtils.relative(root, source);
    if (pathUtils.isAbsolute(withinRoot) || withinRoot.startsWith('..'))
      throw new Error('Sound path escapes pack');
    const sound = await readSound(source);
    if (
      entry.sha256 &&
      createHash('sha256').update(sound.data).digest('hex') !== entry.sha256.toLowerCase()
    )
      throw new Error('Sound checksum mismatch');
    bytes += sound.data.length;
    if (bytes > MAX_PACK_BYTES) throw new Error('Sound pack exceeds size limit');
    sounds.push(sound);
  }
  return { name: manifest.display_name, sounds };
};
