import { describe, expect, it } from 'vitest';

import { volcengineImageModels as imageModels } from './image';

describe('volcengine image model cards', () => {
  /** @see https://docs.volcengine.com/docs/ark/model-deprecation-notice */
  it('lists the Seedream models Volcengine still serves instead of the batch-10 retirements', () => {
    expect(imageModels.map((model) => model.id)).toEqual([
      'doubao-seedream-5-5-261028',
      'doubao-seedream-5-0-pro-260628',
      'doubao-seedream-5-0-flash-260915',
      'doubao-seedream-4-0-20260415',
    ]);
  });

  /** @see https://www.volcengine.com/docs/82379/1541523 */
  it('offers Seedream 5.x only sizes inside the accepted total-pixel range', () => {
    const seedream5 = imageModels.filter((model) => model.id.startsWith('doubao-seedream-5-'));

    for (const model of seedream5) {
      const sizes = (model.parameters?.size as { enum: string[] }).enum;

      for (const size of sizes) {
        const [width, height] = size.split('x').map(Number);
        expect(width * height).toBeGreaterThanOrEqual(921_600);
        expect(width * height).toBeLessThanOrEqual(4_624_220);
      }
    }
  });

  /** @see https://www.volcengine.com/docs/82379/1541523 */
  it('keeps every Seedream 4.0 width/height pair inside the accepted pixel and ratio range', () => {
    const card = imageModels.find((model) => model.id === 'doubao-seedream-4-0-20260415');
    const { height, width } = card?.parameters as Record<string, { max: number; min: number }>;

    expect(width.min * height.min).toBeGreaterThanOrEqual(921_600);
    expect(width.max * height.max).toBeLessThanOrEqual(16_777_216);
    expect(width.max / height.min).toBeLessThanOrEqual(16);
    expect(height.max / width.min).toBeLessThanOrEqual(16);
  });

  /** @see https://docs.volcengine.com/docs/ark/model-pricing */
  it('bills reference images on the Seedream models that charge for them', () => {
    const inputRate = (id: string) =>
      imageModels
        .find((model) => model.id === id)
        ?.pricing?.units.find((unit) => unit.name === 'imageInput');

    expect(inputRate('doubao-seedream-5-5-261028')).toMatchObject({ rate: 0.05, unit: 'image' });
    expect(inputRate('doubao-seedream-5-0-pro-260628')).toMatchObject({
      rate: 0.02,
      unit: 'image',
    });
    expect(inputRate('doubao-seedream-5-0-flash-260915')).toBeUndefined();
    expect(inputRate('doubao-seedream-4-0-20260415')).toBeUndefined();
  });
});
