import { QuickNoteIdentifier } from '@lobechat/builtin-tool-quick-note';
import { builtinTools } from '@lobechat/builtin-tools';
import { describe, expect, it } from 'vitest';

import { quickNoteRuntime } from '../quickNote';

const createRuntime = (scope?: string) =>
  quickNoteRuntime.factory({ scope, userId: 'user-1' } as never);

const valid = { contextQueries: [], relatedResources: [], summary: 'Useful', tags: [] };

describe('quickNoteRuntime.submitResult', () => {
  it('accepts a valid submission and ends the run', async () => {
    const result = await createRuntime('quick_note').submitResult(valid);

    expect(result).toMatchObject({ state: { submitted: true }, stop: true, success: true });
  });

  it('rejects invalid arguments and keeps the run going so the model can retry', async () => {
    const result = await createRuntime('quick_note').submitResult({ summary: '', tags: [] });

    expect(result).toMatchObject({ error: { type: 'INVALID_ARGUMENTS' }, success: false });
    expect(result.stop).toBeUndefined();
    expect(result.content).toContain('Call submitResult again');
  });

  it.each([undefined, 'main', 'task'])(
    'refuses to run outside a Quick Note run (%s)',
    async (scope) => {
      const result = await createRuntime(scope).submitResult(valid);

      expect(result).toMatchObject({ error: { type: 'UNAVAILABLE' }, success: false });
      expect(result.stop).toBeUndefined();
    },
  );
});

describe('Quick Note submit tool registration', () => {
  it('is hidden from tool lists and discovery, and resolves only in the quick_note scope', () => {
    const tool = builtinTools.find(({ identifier }) => identifier === QuickNoteIdentifier);

    expect(tool).toMatchObject({ discoverable: false, hidden: true });
    expect(tool?.resolveManifest?.({ scope: 'quick_note' })?.identifier).toBe(QuickNoteIdentifier);
    expect(tool?.resolveManifest?.({ scope: 'main' })).toBeNull();
  });
});
