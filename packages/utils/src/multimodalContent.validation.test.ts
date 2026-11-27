import { describe, expect, it } from 'vitest';

import { deserializeParts } from './multimodalContent';

describe('multimodal message part validation', () => {
  it.each([null, false, 42, 'text', {}, { type: 1 }, { type: '' }])(
    'does not expose a malformed later part to renderers: %j',
    (part) => {
      expect(deserializeParts(JSON.stringify([{ type: 'text', text: 'valid' }, part]))).toBeNull();
    },
  );

  it('retains all valid parts and their provider metadata', () => {
    const parts = [
      { type: 'text', text: 'hello' },
      { type: 'image', image: 'data:image/png;base64,AA==', thoughtSignature: 'sig' },
    ];
    expect(deserializeParts(JSON.stringify(parts))).toEqual(parts);
  });
});
