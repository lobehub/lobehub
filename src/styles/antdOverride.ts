import { isDesktop } from '@lobechat/const';
import { type Theme } from 'antd-style';
import { css } from 'antd-style';
import { rgba } from 'polished';

export default ({ token }: { prefixCls: string; token: Theme }) => css`
  .${token.prefixCls}-popover {
    z-index: 1100;
  }

  .${token.prefixCls}-menu-item-selected {
    .${token.prefixCls}-menu-title-content {
      color: ${token.colorText};
    }
  }

  .${token.prefixCls}-modal-mask, .${token.prefixCls}-drawer-mask {
    background: ${rgba(token.colorBgLayout, 0.5)} !important;
    backdrop-filter: blur(2px);
  }

  ${isDesktop &&
  css`
    .${token.prefixCls}-modal-mask.${token.prefixCls}-modal-mask-blur {
      background: ${rgba(token.colorBgLayout, 0.8)} !important;
      backdrop-filter: none !important;
    }
  `}
`;
