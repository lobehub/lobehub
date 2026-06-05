import { CLASSNAMES } from '@lobehub/ui';
import type { Theme } from 'antd-style';
import { css } from 'antd-style';

// fix ios input keyboard
// overflow: hidden;
// ref: https://zhuanlan.zhihu.com/p/113855026
// eslint-disable-next-line unicorn/no-anonymous-default-export
export default ({ token }: { prefixCls: string; token: Theme }) => css`
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
    transform: translateZ(0);
  }

  * {
    scrollbar-color: ${token.colorFillSecondary} transparent;
    scrollbar-width: thin;

    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }

    ::-webkit-scrollbar-thumb {
      border-radius: 6px;
      background-color: transparent;
      transition: background-color 200ms ease;
    }

    :hover::-webkit-scrollbar-thumb {
      background-color: ${token.colorFill};
    }

    :active::-webkit-scrollbar-thumb {
      background-color: ${token.colorTextQuaternary};
    }

    ::-webkit-scrollbar-track {
      background-color: transparent;
    }
  }

  button {
    -webkit-app-region: no-drag;
  }

  .${CLASSNAMES.ContextTrigger}[data-popup-open]:not([data-no-highlight]),
  .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight]) {
    background: ${token.colorFillSecondary};
  }
  .accordion-action:has(
    .${CLASSNAMES.DropdownMenuTrigger}[data-popup-open]:not([data-no-highlight])
  ) {
    opacity: 1;
  }
`;
