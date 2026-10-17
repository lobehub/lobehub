import { css, cx } from '@lobehub/ui';

// Buttons opt out of the drag region only inside one. Chromium reports every app-region
// element's unclipped border box in DOM order and Electron lets the later rect win, so
// a global `button { no-drag }` turned every button in the page into a hole in the
// titlebar — including ones scrolled up under it in the content below, which come
// after the titlebar in the DOM.
export const draggable = cx(css`
  -webkit-app-region: drag;

  button {
    -webkit-app-region: no-drag;
  }
`);

export const nodrag = cx(css`
  -webkit-app-region: no-drag;
`);

export const electronStylish = {
  draggable,
  nodrag,
};
