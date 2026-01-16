import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  dragging: css`
    will-change: transform;
    opacity: 0.5;
  `,
  fileItemDragOver: css`
    color: ${cssVar.colorBgElevated} !important;
    background-color: ${cssVar.colorText} !important;

    * {
      color: ${cssVar.colorBgElevated} !important;
    }
  `,
  treeItem: css`
    cursor: pointer;
  `,
}));
