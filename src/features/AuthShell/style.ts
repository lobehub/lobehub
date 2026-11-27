import { createStaticStyles } from '@lobehub/ui';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  embeddedContainer: css`
    overflow: auto;
    background: ${cssVar.colorBgContainer};
  `,

  innerContainerDark: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  innerContainerLight: css`
    position: relative;

    overflow: hidden;

    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};
  `,

  outerContainer: css`
    position: relative;
  `,
}));
