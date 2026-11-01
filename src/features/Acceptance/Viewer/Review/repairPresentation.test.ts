import { describe, expect, it } from 'vitest';

import { repairPresentation } from './repairPresentation';

describe('repair progress', () => {
  it('does not present a finished Agent turn as a verified delivery', () => {
    expect(repairPresentation({ state: 'finished' })).toBe('awaitingDelivery');
  });
  it('keeps verification failures visible even when a preview exists', () => {
    expect(
      repairPresentation({
        state: 'finished',
        deliveryRunStatus: 'failed',
        previewUrl: 'https://preview.example',
      }),
    ).toBe('verificationFailed');
  });
  it('waits for the repaired preview before asking the reviewer to verify', () => {
    expect(repairPresentation({ state: 'finished', deliveryRunStatus: 'passed' })).toBe(
      'awaitingPreview',
    );
    expect(
      repairPresentation({
        state: 'finished',
        deliveryRunStatus: 'passed',
        previewUrl: 'https://preview.example',
      }),
    ).toBe('ready');
  });
  it('shows ongoing verification after the builder turn ends', () => {
    expect(repairPresentation({ state: 'finished', deliveryStatus: 'verifying' })).toBe(
      'verifying',
    );
  });
});
