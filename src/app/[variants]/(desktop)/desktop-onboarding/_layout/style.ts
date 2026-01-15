import { createStaticStyles } from 'antd-style';

import { isMacOSWithLargeWindowBorders } from '@/utils/platform';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Divider 样式
  divider: css`
    height: 24px;
  `,

  // 内层容器 - 深色模式
  innerContainerDark: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${!isMacOSWithLargeWindowBorders()
      ? cssVar.borderRadius
      : `${cssVar.borderRadius} 12px ${cssVar.borderRadius} 12px`};

    background: ${cssVar.colorBgContainer};
  `,

  // 内层容器 - 浅色模式
  innerContainerLight: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${!isMacOSWithLargeWindowBorders()
      ? cssVar.borderRadius
      : `${cssVar.borderRadius} 12px ${cssVar.borderRadius} 12px`};

    background: ${cssVar.colorBgContainer};
  `,

  // 外层容器
  outerContainer: css`
    position: relative;
  `,
}));
