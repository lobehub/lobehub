import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolvePrompt } from './prompt';

const dirs: string[] = [];
const inputFile = async (value: unknown) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lh-prompt-'));
  dirs.push(dir);
  const file = path.join(dir, 'input.json');
  await writeFile(file, JSON.stringify(value));
  return file;
};

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('resolvePrompt — dispatch envelope', () => {
  it('takes the permission mode the run was dispatched with', async () => {
    const resolved = await resolvePrompt({
      inputJson: await inputFile({
        content: [{ text: 'hi', type: 'text' }],
        permissionMode: 'plan',
      }),
    });
    expect(resolved.permissionMode).toBe('plan');
    expect(resolved.prompt).toEqual([{ text: 'hi', type: 'text' }]);
  });

  it('ignores a mode it does not know, and envelopes without one', async () => {
    for (const permissionMode of ['dontAsk', undefined]) {
      const resolved = await resolvePrompt({
        inputJson: await inputFile({ content: [{ text: 'hi', type: 'text' }], permissionMode }),
      });
      expect(resolved.permissionMode).toBeUndefined();
    }
  });

  it('keeps the resume fallback next to the mode', async () => {
    const resolved = await resolvePrompt({
      inputJson: await inputFile({
        content: [{ text: 'hi', type: 'text' }],
        permissionMode: 'default',
        resumeFallback: [{ text: 'history + hi', type: 'text' }],
      }),
    });
    expect(resolved).toMatchObject({
      permissionMode: 'default',
      resumeFallbackPrompt: [{ text: 'history + hi', type: 'text' }],
    });
  });
});
