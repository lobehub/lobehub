import { describe, expect, it } from 'vitest';

import { getLatestCanvasVersion, getLatestSavedManifestKey } from './latestCanvasVersion';

const work = (
  resourceId: string,
  eventVersion: number,
  currentVersion?: number,
  type = 'canvas',
) => ({
  event: { version: eventVersion },
  id: `work_${resourceId}`,
  resourceId,
  type,
  version: currentVersion ? { version: currentVersion } : null,
});

describe('getLatestCanvasVersion', () => {
  it('returns the highest version any message summary knows for the canvas', () => {
    const messages = [
      { id: 'm1', role: 'assistant', works: [work('cvs_1', 1, 1)] },
      { id: 'm2', role: 'assistant', works: [work('cvs_1', 2, 3), work('cvs_2', 9, 9)] },
    ];

    expect(getLatestCanvasVersion(messages as any, 'cvs_1')).toBe(3);
  });

  it('is 0 when no summary mentions the canvas', () => {
    const messages = [
      { id: 'm1', role: 'assistant', works: [work('cvs_1', 4, 4, 'document')] },
      { id: 'm2', role: 'user' },
    ];

    expect(getLatestCanvasVersion(messages as any, 'cvs_1')).toBe(0);
  });
});

const saved = (canvasId: string, manifestKey: string, extra: Record<string, unknown> = {}) => ({
  content: 'Saved',
  id: `msg_${manifestKey}`,
  plugin: { apiName: 'updateCanvas', identifier: 'lobe-canvas' },
  pluginState: { canvasId, metadata: { manifestKey } },
  role: 'tool',
  ...extra,
});

describe('getLatestSavedManifestKey', () => {
  it('returns the manifest of the newest successful save of the canvas', () => {
    const messages = [
      saved('cvs_1', 'm/a.json'),
      saved('cvs_2', 'm/x.json'),
      saved('cvs_1', 'm/b.json'),
      {
        ...saved('cvs_1', 'm/c.json'),
        plugin: { apiName: 'readCanvas', identifier: 'lobe-canvas' },
      },
      { ...saved('cvs_1', 'm/d.json'), plugin: { apiName: 'updateCanvas', identifier: 'other' } },
    ];

    expect(getLatestSavedManifestKey(messages as any, 'cvs_1')).toBe('m/b.json');
  });

  it('is undefined before the canvas was saved in this conversation', () => {
    expect(getLatestSavedManifestKey([saved('cvs_2', 'm/x.json')] as any, 'cvs_1')).toBeUndefined();
  });
});
