import { lobeStaticStylish } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: cx(
    lobeStaticStylish.blur,
    css`
      pointer-events: none;

      position: absolute;
      z-index: 50;
      inset-block-end: 16px;
      inset-inline-end: 16px;
      transform: translateY(16px);

      opacity: 0;
      background: color-mix(in srgb, ${cssVar.colorBgElevated} 50%, transparent) !important;
    `,
  ),
  visible: css`
    pointer-events: all;
    transform: translateY(0);
    opacity: 1;
  `,
}));
