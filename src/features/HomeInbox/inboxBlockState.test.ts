import { resolveInboxBlockState } from './inboxBlockState';

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

  it('drops both states in the rail once news is off, since the rail never shows needs-you', () => {
    expect(
      resolveInboxBlockState({ ...firstLoad, hiddenWidgets: ['news'], hideNeedsYou: true }),
    ).toBeNull();
    expect(
      resolveInboxBlockState({ ...failed, hiddenWidgets: ['news'], hideNeedsYou: true }),
    ).toBeNull();
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
