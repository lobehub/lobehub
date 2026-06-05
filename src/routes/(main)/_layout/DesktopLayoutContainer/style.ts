import { createStaticStyles } from 'antd-style';

import { isDesktop } from '@/const/version';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  innerContainer: css`
    position: relative;

    overflow: hidden;

    border-radius: var(--container-border-radius, 10px);

    background: ${cssVar.colorBgContainer};
    box-shadow: 0 0 0 1px ${cssVar.colorBorderSecondary};
  `,

  outerContainer: css`
    position: relative;

    overflow: hidden;

    padding: ${isDesktop ? '0' : '4px'};
    padding-block-start: ${isDesktop ? '0' : '4px'};
    padding-inline-start: var(--container-padding-left, ${isDesktop ? '0' : '4px'});

    background: ${isDesktop ? 'transparent' : cssVar.colorBgLayout};
  `,
}));
