import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  dragging: css`
    will-change: transform;
    opacity: 0.5;
  `,
  fileItemDragOver: css`
    outline: 1px dashed ${cssVar.colorPrimaryBorder};
    outline-offset: -2px;

    &,
    &:hover {
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  treeItem: css`
    cursor: pointer;
  `,
}));
