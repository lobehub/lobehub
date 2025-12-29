import { type Theme, css } from 'antd-style';
import { rgba } from 'polished';

export default ({ token }: { prefixCls: string; token: Theme }) => css`
  .${token.prefixCls}-popover {
    z-index: 1100;
  }

  .${token.prefixCls}-dropdown-menu {
    border: 1px solid ${token.colorBorder};
    box-shadow: ${token.boxShadow};
  }

  .${token.prefixCls}-menu-sub.${token.prefixCls}-menu-vertical {
    border: 1px solid ${token.colorBorder};
    box-shadow: ${token.boxShadow};
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
`;
