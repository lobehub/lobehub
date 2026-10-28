import { DEFAULT_SYSTEM_AGENT_CONFIG } from '@lobechat/const';
import { describe, expect, it } from 'vitest';

import {
  applySlotChoice,
  applyTierChoice,
  canDisableSlot,
  resolveSlotState,
  restoreAllSlots,
  type StoredSystemAgent,
} from './serviceModelState';

const defaults = DEFAULT_SYSTEM_AGENT_CONFIG;
const FLASH = { model: 'flash-x', provider: 'acme' };
const OTHER = { model: 'other-y', provider: 'acme' };

describe('resolveSlotState', () => {
  it('follows the system recommendation when nothing is stored', () => {
    expect(resolveSlotState({}, defaults, 'topic')).toEqual({
      kind: 'follow',
      tier: 'flash',
      value: { model: defaults.topic.model, provider: defaults.topic.provider },
    });
  });

  it('reads the system defaults of opt-in tasks as off', () => {
    expect(resolveSlotState({}, defaults, 'topicAutoSummary').kind).toBe('off');
    expect(resolveSlotState({}, defaults, 'inputCompletion').kind).toBe('off');
    expect(resolveSlotState({}, defaults, 'followUpAction').kind).toBe('off');
    expect(resolveSlotState({}, defaults, 'promptRewrite').kind).toBe('follow');
  });

  it('reads a slot pinned to its tier model as following', () => {
    const stored: StoredSystemAgent = { tiers: { flash: FLASH }, topic: FLASH };
    expect(resolveSlotState(stored, defaults, 'topic')).toEqual({
      kind: 'follow',
      tier: 'flash',
      value: FLASH,
    });
  });

  it('reads any other pinned model as custom', () => {
    const stored: StoredSystemAgent = { tiers: { flash: FLASH }, topic: OTHER };
    expect(resolveSlotState(stored, defaults, 'topic')).toEqual({ kind: 'custom', value: OTHER });
  });

  it('treats an empty speech-to-text model as off', () => {
    expect(resolveSlotState({ asr: { model: '', provider: '' } }, defaults, 'asr').kind).toBe(
      'off',
    );
  });
});

describe('applyTierChoice', () => {
  it('writes the verify tier into the verify slot the server reads, and only there', () => {
    const VISION = { model: 'vision-z', provider: 'acme' };
    const next = applyTierChoice({}, 'verify', VISION);

    expect(next.tiers).toEqual({ verify: VISION });
    expect(next.verify).toEqual(VISION);
    expect(next.goal).toBeUndefined();
    expect(resolveSlotState(next, defaults, 'verify')).toEqual({
      kind: 'follow',
      tier: 'verify',
      value: VISION,
    });

    const cleared = applyTierChoice(next, 'verify', undefined);
    expect(cleared.tiers).toBeUndefined();
    expect(cleared.verify).toBeUndefined();
  });

  it('writes the tier model into following slots and keeps custom ones', () => {
    const next = applyTierChoice({ translation: OTHER }, 'flash', FLASH);

    expect(next.tiers).toEqual({ flash: FLASH });
    expect(next.topic).toEqual(FLASH);
    expect(next.thread).toEqual(FLASH);
    expect(next.translation).toEqual(OTHER);
    // other tiers are untouched
    expect(next.agentMeta).toBeUndefined();
  });

  it('moves slots that followed the old tier value to the new one', () => {
    const before = applyTierChoice({}, 'flash', FLASH);
    const next = applyTierChoice(before, 'flash', OTHER);

    expect(next.topic).toEqual(OTHER);
    expect(resolveSlotState(next, defaults, 'topic').kind).toBe('follow');
  });

  it('drops the pins when the tier goes back to the system recommendation', () => {
    const before = applyTierChoice({ translation: OTHER }, 'flash', FLASH);
    const next = applyTierChoice(before, 'flash', undefined);

    expect(next.tiers).toBeUndefined();
    expect(next.topic).toBeUndefined();
    expect(next.translation).toEqual(OTHER);
  });

  it('keeps the enabled flag of a disabled task while updating its model', () => {
    const next = applyTierChoice({}, 'flash', FLASH);

    expect(next.inputCompletion).toEqual({ ...FLASH });
    expect(resolveSlotState(next, defaults, 'inputCompletion').kind).toBe('off');
  });

  it('leaves skipped slots alone', () => {
    const next = applyTierChoice({}, 'flash', FLASH, {
      skipSlots: new Set(['followUpAction', 'inputCompletion']),
    });

    expect(next.followUpAction).toBeUndefined();
    expect(next.inputCompletion).toBeUndefined();
  });
});

describe('applySlotChoice', () => {
  it('pins a custom model', () => {
    const next = applySlotChoice({}, 'translation', { kind: 'custom', value: OTHER });
    expect(resolveSlotState(next, defaults, 'translation')).toEqual({
      kind: 'custom',
      value: OTHER,
    });
  });

  it('restores a custom slot to the system recommendation by removing the pin', () => {
    const next = applySlotChoice({ translation: OTHER }, 'translation', { kind: 'follow' });
    expect(next.translation).toBeUndefined();
  });

  it('restores a custom slot to its tier model when the tier is set', () => {
    const stored = applyTierChoice({ translation: OTHER }, 'flash', FLASH);
    const next = applySlotChoice(stored, 'translation', { kind: 'follow' });

    expect(next.translation).toEqual(FLASH);
    expect(resolveSlotState(next, defaults, 'translation').kind).toBe('follow');
  });

  it('turns an opt-in task on when its follow item is picked, and off again', () => {
    const on = applySlotChoice({}, 'topicAutoSummary', { kind: 'follow' });
    expect(on.topicAutoSummary).toEqual({ enabled: true });
    expect(resolveSlotState(on, defaults, 'topicAutoSummary').kind).toBe('follow');

    const off = applySlotChoice(on, 'topicAutoSummary', { kind: 'off' });
    expect(resolveSlotState(off, defaults, 'topicAutoSummary').kind).toBe('off');
  });

  it('turns speech-to-text off with an empty model and back on by following', () => {
    const off = applySlotChoice({}, 'asr', { kind: 'off' });
    expect(off.asr).toEqual({ model: '', provider: '' });

    const on = applySlotChoice(off, 'asr', { kind: 'follow' });
    expect(on.asr).toBeUndefined();
  });

  it('keeps other stored fields of a slot', () => {
    const next = applySlotChoice(
      { userMemoryEmbedding: { ...OTHER, contextLimit: 512 } },
      'userMemoryEmbedding',
      { kind: 'follow' },
    );
    expect(next.userMemoryEmbedding).toEqual({ contextLimit: 512 });
  });
});

describe('restoreAllSlots', () => {
  it('unpins custom slots and keeps disabled tasks disabled', () => {
    const stored: StoredSystemAgent = {
      followUpAction: { enabled: false },
      tiers: { flash: FLASH },
      topic: FLASH,
      translation: OTHER,
    };
    const next = restoreAllSlots(stored, defaults, ['translation', 'topic', 'followUpAction']);

    expect(next.translation).toEqual(FLASH);
    expect(resolveSlotState(next, defaults, 'followUpAction').kind).toBe('off');
  });
});

describe('canDisableSlot', () => {
  it('only offers 不启用 where the runtime honours it', () => {
    expect(canDisableSlot('topicAutoSummary')).toBe(true);
    expect(canDisableSlot('asr')).toBe(true);
    expect(canDisableSlot('userMemoryEmbedding')).toBe(false);
    expect(canDisableSlot('topic')).toBe(false);
  });
});
