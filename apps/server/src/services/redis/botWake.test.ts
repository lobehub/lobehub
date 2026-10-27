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

  it('has no follow-up author without a window', () => {
    expect(
      mergeBotWakeChannelFields([{ followupAuthorId: 'u1', silentWakes: 0 }]).followupAuthorId,
    ).toBeUndefined();
  });
});
