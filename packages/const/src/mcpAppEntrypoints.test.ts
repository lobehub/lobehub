import { describe, expect, it } from 'vitest';

import { getMcpAppEntrypoints, isMcpThreadEntrypoint } from './mcpAppEntrypoints';

const meta = {
  'ui': { resourceUri: 'ui://app', visibility: [] },
  'openai/ui': { entrypoints: [{ type: 'thread' }] },
};
describe('thread app discovery', () => {
  it('uses title then annotation then name, and tool icons then server icons', () => {
    expect(
      getMcpAppEntrypoints(
        [
          {
            name: 'one',
            title: 'Title',
            annotations: { title: 'Annotation' },
            icons: [{ src: 'tool.png' }],
            _meta: meta,
          },
          { name: 'two', annotations: { title: 'Annotation' }, _meta: meta },
          { name: 'three', _meta: meta },
        ],
        true,
        [{ src: 'server.png' }],
      ),
    ).toEqual([
      { toolName: 'one', title: 'Title', icon: 'tool.png' },
      { toolName: 'two', title: 'Annotation', icon: 'server.png' },
      { toolName: 'three', title: 'three', icon: 'server.png' },
    ]);
  });
  it('requires a view and thread declaration; does not offer global/file entries', () => {
    expect(
      isMcpThreadEntrypoint({ resourceUri: 'ui://app', entrypoints: [{ type: 'thread' }] }),
    ).toBe(true);
    expect(isMcpThreadEntrypoint({ entrypoints: [{ type: 'thread' }] })).toBe(false);
    expect(
      getMcpAppEntrypoints(
        [
          {
            name: 'global',
            _meta: {
              'ui': { resourceUri: 'ui://app' },
              'lobehub/ui': { entrypoints: [{ type: 'global' }] },
            },
          },
        ],
        true,
      ),
    ).toEqual([]);
  });
  it('does not inspect metadata with the flag off', () => {
    const tool = {
      name: 'private',
      get _meta() {
        throw new Error('must not parse');
      },
    };
    expect(getMcpAppEntrypoints([tool], false)).toEqual([]);
  });
});
