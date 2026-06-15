import { describe, expect, it } from 'vitest';

import { publishResourceEvent, resourceChannelId } from '../index';

describe('resourceEvents', () => {
  it('formats a stable channel id per resource', () => {
    expect(resourceChannelId({ id: 'doc-1', type: 'document' })).toBe('resource:document:doc-1');
  });

  it('publish is best-effort and never throws (no Redis → in-memory)', async () => {
    await expect(
      publishResourceEvent(
        { id: 'doc-1', type: 'document' },
        { actorId: 'u1', type: 'doc.updated' },
      ),
    ).resolves.toBeUndefined();

    await expect(
      publishResourceEvent(
        { id: 'doc-1', type: 'document' },
        { actorId: 'u1', data: { holderId: null }, type: 'lock.changed' },
      ),
    ).resolves.toBeUndefined();
  });
});
