import { Icon } from '@lobehub/ui';
import { Collapse, type CollapseProps } from 'antd';
import { createStaticStyles , responsive } from 'antd-style';
import { ChevronDown } from 'lucide-react';
import { memo } from 'react';

const prefixCls = 'ant';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    .${prefixCls}-collapse-header {
      padding-inline: 16px 10px !important;
      border-radius: ${cssVar.borderRadius} !important;
      color: ${cssVar.colorTextDescription} !important;

      ${responsive.sm} {
        border-radius: 0 !important;
      }

      &:hover {
        color: ${cssVar.colorText} !important;
        background: ${cssVar.colorFillTertiary};
        .${prefixCls}-collapse-extra {
          display: block;
        }
      }
    }
    .${prefixCls}-collapse-extra {
      display: none;
    }
    .${prefixCls}-collapse-content {
      border-radius: 0 !important;
    }
    .${prefixCls}-collapse-content-box {
      padding: 0 !important;
    }
  `,
  icon: css`
    transition: all 100ms ${cssVar.motionEaseOut};
  `,
}));

const CollapseGroup = memo<CollapseProps>((props) => {
  return (
    <Collapse
      bordered={false}
      className={styles.container}
      expandIcon={({ isActive }) => (
        <Icon
          className={styles.icon}
          icon={ChevronDown}
          size={16}
          style={isActive ? {} : { rotate: '-90deg' }}
        />
      )}
      expandIconPlacement={'end'}
      ghost
      size={'small'}
      {...props}
    />
  );
});

export default CollapseGroup;
