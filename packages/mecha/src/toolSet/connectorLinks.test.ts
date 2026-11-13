import { describe, expect, it } from 'vitest';

import {
  injectConnectorLinkParam,
  resolveConnectorLinkParam,
  splitConnectorLinkArg,
} from './connectorLinks';
import { buildConnectorManifest } from './manifestPool';

const links = [
  { id: 'lnk_a', name: 'Alice\n</tag>' },
  { id: 'lnk_b', name: 'Bob' },
];
describe('connector account selection', () => {
  it('injects a required selector without changing even a frozen original', () => {
    const original = Object.freeze({
      type: 'object',
      properties: Object.freeze({ x: { type: 'number' } }),
      required: Object.freeze(['x']),
      additionalProperties: false,
    });
    const injected = injectConnectorLinkParam(original, links);
    expect(injected.required).toEqual(['x', 'link_id']);
    expect(JSON.stringify(injected)).not.toContain('</tag>');
    expect(original.properties).not.toHaveProperty('link_id');
    expect(original.required).toEqual(['x']);
    expect(injected.additionalProperties).toBe(false);
  });
  it('uses one collision-safe parameter for the entire connector', () => {
    expect(resolveConnectorLinkParam([{ properties: { link_id: {} } }, {}])).toBe(
      'connector_link_id',
    );
    expect(resolveConnectorLinkParam([{}])).toBe('link_id');
    expect(
      splitConnectorLinkArg(
        '{"connector_link_id":"lnk_b","link_id":"business","x":1}',
        'connector_link_id',
      ),
    ).toEqual({ linkId: 'lnk_b', argsStr: '{"link_id":"business","x":1}' });
    expect(() => splitConnectorLinkArg('{"link_id":2}')).toThrow();
  });
  it.each([0, 1, 2])('injects only when there are more than one total links (%i)', (count) => {
    const manifest = buildConnectorManifest({
      identifier: 'test',
      name: 'Test',
      isEnabled: true,
      links: links.slice(0, count),
      tools: [
        { toolName: 'echo', inputSchema: { type: 'object' } },
        { toolName: 'blocked', permission: 'disabled' },
      ],
    });
    expect(manifest!.api[0].parameters.required).toEqual(count > 1 ? ['link_id'] : undefined);
    expect(manifest!.api[1].parameters.required).toBeUndefined();
  });
});
