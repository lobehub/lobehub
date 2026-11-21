import { describe, expect, it } from 'vitest';

import { buildCanvasOpenUrl } from './url';

const target = { agentId: 'agt_1', canvasId: 'cvs_1', topicId: 'tpc_1' };

describe('buildCanvasOpenUrl', () => {
  it('links to the conversation with the canvas query', () => {
    expect(buildCanvasOpenUrl('https://app.example.com/', target)).toBe(
      'https://app.example.com/agent/agt_1/tpc_1?canvas=cvs_1',
    );
  });

  it('keeps the workspace in the path', () => {
    expect(
      buildCanvasOpenUrl('https://app.example.com', { ...target, workspaceSlug: 'acme' }),
    ).toBe('https://app.example.com/acme/agent/agt_1/tpc_1?canvas=cvs_1');
  });

  it.each([
    ['origin', undefined, target],
    ['agent', 'https://app.example.com', { ...target, agentId: null }],
    ['topic', 'https://app.example.com', { ...target, topicId: undefined }],
  ])('returns undefined without a %s', (_name, origin, input) => {
    expect(buildCanvasOpenUrl(origin, input)).toBeUndefined();
  });
});
