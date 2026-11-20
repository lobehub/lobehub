import { describe, expect, it } from 'vitest';

import { takeLocalConnectorAccount } from './localConnector';

const tools = [{ inputSchema: { properties: { x: {} } } }];
const holding = (count: number) => ({
  links: Array.from({ length: count }, (_, i) => ({ id: `lnk_${i}` })),
});

describe('takeLocalConnectorAccount', () => {
  it('takes the selector out of the arguments the MCP server receives', () => {
    expect(takeLocalConnectorAccount(holding(2), tools, '{"link_id":"lnk_1","x":1}')).toEqual({
      args: '{"x":1}',
      linkId: 'lnk_1',
    });
  });

  it('requires a selection while several accounts remain', () => {
    expect(() => takeLocalConnectorAccount(holding(2), tools, '{"x":1}')).toThrow(
      'link_id is required',
    );
  });

  // A call made while two accounts existed, run after one was removed
  it('keeps the selection with one account left, so a removed one is not swapped', () => {
    expect(takeLocalConnectorAccount(holding(1), tools, '{"link_id":"lnk_gone","x":1}')).toEqual({
      args: '{"x":1}',
      linkId: 'lnk_gone',
    });
    expect(takeLocalConnectorAccount(holding(1), tools, '{"x":1}')).toEqual({
      args: '{"x":1}',
      linkId: undefined,
    });
  });

  it('leaves a connector without accounts untouched', () => {
    expect(takeLocalConnectorAccount(holding(0), tools, '{"link_id":"x"}')).toEqual({
      args: '{"link_id":"x"}',
    });
  });

  it('refuses a view selection that contradicts the arguments', () => {
    expect(() =>
      takeLocalConnectorAccount(holding(2), tools, '{"link_id":"lnk_0"}', 'lnk_1'),
    ).toThrow('Conflicting account selections');
  });
});
