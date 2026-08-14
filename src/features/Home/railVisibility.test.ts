import { canHostRail, RAIL_INBOX_PROPS, resolveRailVisibility } from './railVisibility';

const signedIn = { isLogin: true, showHomeRail: true };

describe('resolveRailVisibility', () => {
  it('shows the rail to a signed-in viewer who has kept the preference on', () => {
    expect(resolveRailVisibility({ ...signedIn, hiddenWidgets: [] })).toBe(true);
  });

  it('hides the rail from a signed-out visitor', () => {
    expect(resolveRailVisibility({ hiddenWidgets: [], isLogin: false, showHomeRail: true })).toBe(
      false,
    );
  });

  it('hides the rail when the viewer collapsed it', () => {
    expect(resolveRailVisibility({ hiddenWidgets: [], isLogin: true, showHomeRail: false })).toBe(
      false,
    );
  });

  it('keeps the rail while one of the widgets it hosts is still on', () => {
    expect(resolveRailVisibility({ ...signedIn, hiddenWidgets: ['news', 'suggestions'] })).toBe(
      true,
    );
  });

  it('hides the rail once every widget it hosts is off, even with the preference on', () => {
    expect(
      resolveRailVisibility({
        ...signedIn,
        hiddenWidgets: ['goals', 'running', 'news', 'suggestions'],
      }),
    ).toBe(false);
  });

  it('does not let needs-you or unread keep the rail alive, since it never renders them', () => {
    expect(
      resolveRailVisibility({
        ...signedIn,
        hiddenWidgets: ['goals', 'running', 'news', 'suggestions'],
      }),
    ).toBe(false);
    expect(RAIL_INBOX_PROPS).toEqual({ hideNeedsYou: true, hideUnread: true });
  });
});

describe('canHostRail', () => {
  it('answers only the widget question, so the toggle survives a collapsed rail', () => {
    expect(canHostRail([])).toBe(true);
  });

  it('goes false exactly when the rail has no widget left to show', () => {
    expect(canHostRail(['goals', 'running', 'news', 'suggestions'])).toBe(false);
  });

  it('stays true while needs-you and unread are the only ones off', () => {
    expect(canHostRail(['needsYou', 'unread'])).toBe(true);
  });
});
