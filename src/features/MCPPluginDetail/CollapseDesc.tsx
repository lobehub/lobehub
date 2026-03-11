import { Text } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { type PropsWithChildren } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    desc: css`
      overflow: hidden;
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;

      height: 28px;
      margin-block: 4px 0 !important;

      font-size: 14px;
      line-height: 28px;
      color: ${cssVar.colorTextSecondary};
      text-overflow: ellipsis;

      transition:
        margin-block-start 0.3s ${cssVar.motionEaseInOut},
        height 0.3s ${cssVar.motionEaseInOut},
        opacity 0.2s ${cssVar.motionEaseInOut};
    `,
    hideDesc: css`
      height: 0;
      margin-block-start: 0;
      opacity: 0;
    `,
  };
});

const CollapseDesc = memo<PropsWithChildren<{ hide?: boolean }>>(({ children, hide }) => {
  return (
    <Text as={'p'} className={cx(styles.desc, hide && styles.hideDesc)}>
      {children}
    </Text>
  );
});

export default CollapseDesc;
