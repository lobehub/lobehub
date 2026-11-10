import { createStaticStyles } from '@lobehub/ui';

import { isMacOSWithLargeWindowBorders } from '@/utils/platform';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Inner container - dark mode
  innerContainerDark: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${
      !isMacOSWithLargeWindowBorders()
        ? cssVar.borderRadius
        : `${cssVar.borderRadius} 12px ${cssVar.borderRadius} 12px`
    };

    background: ${cssVar.colorBgContainer};
  `,

  // Inner container - light mode
  innerContainerLight: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${
      !isMacOSWithLargeWindowBorders()
        ? cssVar.borderRadius
        : `${cssVar.borderRadius} 12px ${cssVar.borderRadius} 12px`
    };

    background: ${cssVar.colorBgContainer};
  `,

  // Outer container
  outerContainer: css`
    position: relative;
  `,
}));
