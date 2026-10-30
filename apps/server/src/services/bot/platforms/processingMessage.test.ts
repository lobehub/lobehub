import { describe, expect, it } from 'vitest';

import { processingMessageField, shouldPostProcessingMessage } from './const';
import { schema as qqSchema } from './qq/schema';

describe('shouldPostProcessingMessage', () => {
  it('keeps the message for rows saved before the field existed', () => {
    expect(shouldPostProcessingMessage(undefined)).toBe(true);
    expect(shouldPostProcessingMessage({})).toBe(true);
  });

  it('turns the message off only on an explicit false', () => {
    expect(shouldPostProcessingMessage({ processingMessage: false })).toBe(false);
    expect(shouldPostProcessingMessage({ processingMessage: true })).toBe(true);
    expect(shouldPostProcessingMessage({ processingMessage: 'false' })).toBe(true);
  });
});

describe('processingMessageField', () => {
  it('defaults to on and is exposed in the QQ settings', () => {
    expect(processingMessageField.default).toBe(true);
    const settings = qqSchema.find((field) => field.key === 'settings');
    expect(settings?.properties?.some((field) => field.key === 'processingMessage')).toBe(true);
  });
});
