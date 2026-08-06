import { CLASSNAMES } from '@lobehub/ui';
import type { Theme } from 'antd-style';
import { css } from 'antd-style';

// fix ios input keyboard
// overflow: hidden;
// ref: https://zhuanlan.zhihu.com/p/113855026
const genGlobalStyle = ({ token }: { prefixCls: string; token: Theme }) => css`
  html,
  body,
  #__next {
    position: relative;

    overscroll-behavior: none;

    height: 100%;
    min-height: 100dvh;
    max-height: 100dvh;

    @media (device-width >= 576px) {
      overflow: hidden;
    }
  }

  body {
    /* Increase compositing layer, force hardware acceleration, otherwise render black edges will appear */
    will-change: opacity;
    transform: translateZ(0);
  }

  * {
    scrollbar-color: ${token.colorFill} transparent;
    scrollbar-width: thin;

    ::-webkit-scrollbar {
      width: 0.75em;
      height: 0.75em;
    }

    ::-webkit-scrollbar-thumb {
      border-radius: 10px;
    }

    :hover::-webkit-scrollbar-thumb {
      border: 3px solid transparent;
      background-color: ${token.colorText};
      background-clip: content-box;
    }

    ::-webkit-scrollbar-track {
      background-color: transparent;
    }
  }

  html.desktop[data-theme='dark'] body {
    background-color: color-mix(in srgb, ${token.colorBgLayout} 50%, transparent);
  }

  html.desktop[data-theme='light'] body {
    background-color: color-mix(in srgb, ${token.colorBgLayout} 70%, transparent);
  }

  button {
    -webkit-app-region: no-drag;
  }

  .${CLASSNAMES.ContextTrigger}[data-popup-open]:not([data-no-highlight]),
  .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight]) {
    background: ${token.colorFillTertiary};
  }
  .accordion-action:has(
    .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight])
  ) {
    opacity: 1;
  }

  /*
   * RTL fixes for @lobehub/ui base-ui Switch / Tabs / Segmented.
   *
   * Switch: page dir=rtl mirrors the flex track AND multiplies thumb travel by
   * --switch-dir:-1, so the knob/background animate the wrong way. Keep the
   * control LTR (standard toggle UX) under RTL documents.
   *
   * Tabs / Segmented indicators (Settings → Appearance animation, platform/org
   * admin tabs, etc.): JS writes physical offsetLeft into --active-tab-left /
   * --active-item-left, but component CSS binds logical inset-inline-start.
   * Under RTL that mirrors the pill away from the active option. Always force
   * physical \`left\` (safe in LTR too — left === inset-inline-start there).
   * Do not gate on html[dir=rtl] only: antd direction=rtl can nest :dir(rtl)
   * without html.dir matching yet.
   */
  :dir(rtl) [role='switch'],
  html[dir='rtl'] [role='switch'] {
    --switch-dir: 1;

    direction: ltr;
  }

  /* stylelint-disable liberty/use-logical-spec -- indicator offsets are physical */
  [role='tablist'] > [role='presentation'] {
    right: auto !important;
    left: var(--active-tab-left) !important;
    inset-inline: auto !important;
    transition-property: left, top, inset-block-start, width, height, transform !important;
  }

  [data-orientation] > [aria-hidden='true']:first-of-type {
    right: auto !important;
    left: var(--active-item-left) !important;
    inset-inline: auto !important;
    transition-property: left, top, inset-block-start, width, height, transform !important;
  }
  /* stylelint-enable liberty/use-logical-spec */
`;

export default genGlobalStyle;
