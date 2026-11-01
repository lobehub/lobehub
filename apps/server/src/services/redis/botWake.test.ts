// @vitest-environment node
import { mergeBotWakeChannelFields } from './botWake';

describe('mergeBotWakeChannelFields', () => {
  it('takes the follow-up author from the key whose window ends last', () => {
    expect(
      mergeBotWakeChannelFields([
        { followupAuthorId: 'old', followupUntil: 1_000, silentWakes: 0 },
        { followupAuthorId: 'new', followupUntil: 2_000, silentWakes: 1 },
      ]),
    ).toMatchObject({ followupAuthorId: 'new', followupUntil: 2_000, silentWakes: 1 });
  });

  it('keeps the latest stand-down of any key: stepping back from the thread holds', () => {
    expect(
      mergeBotWakeChannelFields([
        { silentWakes: 0 },
        { silentWakes: 0, standDownUntil: 5_000 },
        { silentWakes: 0, standDownUntil: 3_000 },
      ]).standDownUntil,
    ).toBe(5_000);
    expect(mergeBotWakeChannelFields([{ silentWakes: 0 }]).standDownUntil).toBeUndefined();
  });

  it('has no follow-up author without a window', () => {
    expect(
      mergeBotWakeChannelFields([{ followupAuthorId: 'u1', silentWakes: 0 }]).followupAuthorId,
    ).toBeUndefined();
  });
});
