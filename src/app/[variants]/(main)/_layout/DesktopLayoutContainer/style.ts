import { createStaticStyles } from 'antd-style';

import { isDesktop } from '@/const/version';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // 内层容器
  innerContainer: css`
    position: relative;

    overflow: hidden;

    border: 1px solid var(--container-border-color, ${cssVar.colorBorder});
    border-radius: var(--container-border-radius, ${cssVar.borderRadius});
    border-end-end-radius: var(
      --container-border-bottom-right-radius,
      var(--container-border-radius, ${cssVar.borderRadius})
    );

    background: ${cssVar.colorBgContainer};
  `,

  // 外层容器
  outerContainer: css`
    position: relative;

    overflow: hidden;

    padding-block-start: var(--container-padding-top, 8px);
    padding-inline-start: var(--container-padding-left, 8px);

    background: ${isDesktop ? 'transparent' : cssVar.colorBgLayout};
  `,
}));
