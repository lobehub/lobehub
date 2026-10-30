import { resolveInboxBlockState, resolveSignedOutRailState } from './inboxBlockState';

const firstLoad = { hasError: false, hiddenWidgets: [], isBriefsInit: false, isLoading: true };
const failed = { hasError: true, hiddenWidgets: [], isBriefsInit: false, isLoading: false };

describe('resolveInboxBlockState', () => {
  it('shows skeletons on first load', () => {
    expect(resolveInboxBlockState(firstLoad)).toBe('skeleton');
  });

  it('shows the block error once the first load has failed and settled', () => {
    expect(resolveInboxBlockState(failed)).toBe('error');
  });

  it('keeps the skeletons while a failed load is being retried', () => {
    expect(resolveInboxBlockState({ ...failed, isLoading: true })).toBe('skeleton');
  });

  it('steps aside once the briefs have arrived', () => {
    expect(resolveInboxBlockState({ ...firstLoad, isBriefsInit: true })).toBeNull();
  });

  it('never takes over the main column, which carries these states as sections', () => {
    expect(resolveInboxBlockState({ ...firstLoad, isMain: true })).toBeNull();
    expect(resolveInboxBlockState({ ...failed, isMain: true })).toBeNull();
  });

  it('never holds the rail, which shows no brief feed of its own', () => {
    expect(resolveInboxBlockState({ ...firstLoad, hideNeedsYou: true })).toBeNull();
    expect(resolveInboxBlockState({ ...failed, hideNeedsYou: true })).toBeNull();
  });

  it('keeps them where needs-you still renders, even with news off', () => {
    expect(resolveInboxBlockState({ ...firstLoad, hiddenWidgets: ['news'] })).toBe('skeleton');
  });

  it('keeps them for news alone when only needs-you is off', () => {
    expect(resolveInboxBlockState({ ...firstLoad, hiddenWidgets: ['needsYou'] })).toBe('skeleton');
  });

  it('drops them once both brief-powered widgets are off', () => {
    expect(
      resolveInboxBlockState({ ...firstLoad, hiddenWidgets: ['needsYou', 'news'] }),
    ).toBeNull();
    expect(resolveInboxBlockState({ ...failed, hiddenWidgets: ['needsYou', 'news'] })).toBeNull();
  });
});

describe('resolveSignedOutRailState', () => {
  it('holds the rail with skeletons while the session restores the last signed-in user', () => {
    expect(resolveSignedOutRailState({ isRail: true, restoringSession: true })).toBe('skeleton');
  });

  it('renders nothing for a visitor the session will not sign in', () => {
    expect(resolveSignedOutRailState({ isRail: true, restoringSession: false })).toBeNull();
  });

  it('leaves the main column to its own signed-out state', () => {
    expect(resolveSignedOutRailState({ isRail: false, restoringSession: true })).toBeNull();
  });
});
