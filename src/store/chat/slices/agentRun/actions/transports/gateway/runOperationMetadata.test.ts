import { describe, expect, it } from 'vitest';

import { gatewayRunOperationMetadata } from './runOperationMetadata';

describe('gatewayRunOperationMetadata', () => {
  it('keeps the server run id and its producer type on the local op', () => {
    expect(gatewayRunOperationMetadata({ heteroType: 'claude-code', operationId: 'op-1' })).toEqual(
      { heteroType: 'claude-code', serverOperationId: 'op-1' },
    );
  });

  it('preserves an explicit native-runtime marker', () => {
    expect(gatewayRunOperationMetadata({ heteroType: null, operationId: 'op-1' })).toEqual({
      heteroType: null,
      serverOperationId: 'op-1',
    });
  });
});
