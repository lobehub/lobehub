import { describe, expect, it } from 'vitest';

import {
  BOT_WAKE_SETTING_KEYS as KEY,
  MAX_BOT_WAKE_CHANNEL_LIST,
} from '@/server/services/agentSignal/scenarios/botWake/config';

import { botWakeFields } from './botWakeFields';

const fieldByKey = (key: string) => botWakeFields.find((field) => field.key === key);

describe('botWakeFields channel lists', () => {
  it('should declare the same cap the runtime parser applies', () => {
    // `parseBotWakeSettings` drops an over-cap list to `[]`, so the editor must read the same
    // number — otherwise the form happily stores 201 channels that stop restricting anything.
    for (const key of [KEY.allowChannels, KEY.denyChannels]) {
      expect(fieldByKey(key)?.maximum).toBe(MAX_BOT_WAKE_CHANNEL_LIST);
    }
  });

  it('should keep the cap on the list field itself, not on the row schema', () => {
    const list = fieldByKey(KEY.allowChannels)!;

    expect(list.type).toBe('array');
    expect(list.items?.maximum).toBeUndefined();
  });
});
