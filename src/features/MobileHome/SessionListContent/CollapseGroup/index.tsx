import { Icon } from '@lobehub/ui';
import { type CollapseProps } from 'antd';
import { Collapse } from 'antd';
import { createStaticStyles, responsive } from 'antd-style';
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
      ghost
      bordered={false}
      className={styles.container}
      expandIconPlacement={'end'}
      size={'small'}
      expandIcon={({ isActive }) => (
        <Icon
          className={styles.icon}
          icon={ChevronDown}
          size={16}
          style={isActive ? {} : { rotate: '-90deg' }}
        />
      )}
      {...props}
    />
  );
});

export default CollapseGroup;
