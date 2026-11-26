import { describe, expect, it } from 'vitest';

import { chatTopicMetadataUpdateSchema } from '../topic/topic';
import { applyTopicModelToHeterogeneousProvider } from './agencyConfig';
import {
  buildHeteroExecArgs,
  buildHeteroSpawnArgs,
  resolveCodexSpeedMode,
} from './heteroSelectorCapabilities';

describe('Codex speed selection', () => {
  it.each([
    ['normal', 'default'],
    ['fast', 'fast'],
    ['ultrafast', 'ultrafast'],
  ] as const)('forwards %s through a topic pin into the native CLI and wrapper', (speed, tier) => {
    expect(chatTopicMetadataUpdateSchema.parse({ heteroSpeed: speed })).toEqual({
      heteroSpeed: speed,
    });
    const effective = applyTopicModelToHeterogeneousProvider(
      { type: 'codex', model: 'gpt-6.1-sol', args: ['-c', 'service_tier="fast"'] },
      { speed },
    );
    expect(buildHeteroSpawnArgs(effective)).toContain(`service_tier="${tier}"`);
    expect(buildHeteroSpawnArgs(effective)).not.toContain('service_tier="priority"');
    expect(buildHeteroExecArgs(effective)).toEqual(expect.arrayContaining(['--speed', speed]));
    expect(resolveCodexSpeedMode(effective)).toBe(speed);
  });

  it('distinguishes an explicit normal tier from inheriting the CLI config', () => {
    expect(resolveCodexSpeedMode({ args: ['-c', 'service_tier="default"'] })).toBe('normal');
    expect(buildHeteroSpawnArgs({ type: 'codex', speed: 'default' })).toBeUndefined();
  });
});
