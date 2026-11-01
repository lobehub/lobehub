import { describe, expect, it } from 'vitest';

import { resolveOversizePlan } from './resolveOversizePlan';

const MB = 1024 * 1024;

describe('resolveOversizePlan', () => {
  it('leaves an in-budget attachment alone', () => {
    const plan = resolveOversizePlan({ attachmentType: 'image', platform: 'wechat', size: 1 * MB });

    expect(plan).toMatchObject({ offersChoice: false, oversize: false });
  });

  it('offers the choice for an oversize image', () => {
    const plan = resolveOversizePlan({ attachmentType: 'image', platform: 'wechat', size: 3 * MB });

    expect(plan).toMatchObject({ limit: 2 * MB, offersChoice: true, oversize: true });
  });

  it('offers no choice above the server compression ceiling', () => {
    // Regression: the modal offered "compress it" and spelled out a re-encode
    // for a file `prepareAttachmentsForBudget` refuses to buffer at all, so the
    // option behaved exactly like "send a link" while promising otherwise.
    const plan = resolveOversizePlan({
      attachmentType: 'image',
      platform: 'wechat',
      size: 101 * MB,
    });

    expect(plan).toMatchObject({ offersChoice: false, oversize: true });
  });

  it('offers no choice for an oversize non-image — nothing smaller exists', () => {
    const plan = resolveOversizePlan({
      attachmentType: 'video',
      platform: 'wechat',
      size: 30 * MB,
    });

    expect(plan).toMatchObject({ limit: 20 * MB, offersChoice: false, oversize: true });
  });

  it('promises nothing when the size is unknown', () => {
    const plan = resolveOversizePlan({ attachmentType: 'image', platform: 'wechat' });

    expect(plan).toMatchObject({ offersChoice: false, oversize: false });
  });

  it('measures an image against the image budget and a file against the file budget', () => {
    const image = resolveOversizePlan({ attachmentType: 'image', platform: 'telegram', size: 1 });
    const file = resolveOversizePlan({ attachmentType: 'file', platform: 'telegram', size: 1 });

    expect(image.limit).toBe(5 * MB);
    expect(file.limit).toBe(20 * MB);
  });
});
