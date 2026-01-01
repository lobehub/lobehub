import { Icon } from '@lobehub/ui';
import { createStaticStyles , responsive } from 'antd-style';
import { XIcon } from 'lucide-react';

const prefixCls = 'ant';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    content: css`
      .${prefixCls}-modal-container {
        overflow: hidden;

        width: min(90vw, 450px);
        padding: 0;
        border: 1px solid ${cssVar.colorSplit};
        border-radius: ${cssVar.borderRadiusLG};

        background: ${cssVar.colorBgLayout};

        ${responsive.sm} {
          width: unset;
        }
      }
      .${prefixCls}-modal-confirm-title {
        display: block;
        padding-block: 16px 0;
        padding-inline: 16px;
      }
      .${prefixCls}-modal-confirm-btns {
        margin-block-start: 0;
        padding: 16px;
      }

      .${prefixCls}-modal-confirm-paragraph {
        max-width: 100%;
      }
    `,
    wrap: css`
      overflow: hidden auto;
    `,
  };
});

export const closeIcon = <Icon icon={XIcon} size={20} />;
