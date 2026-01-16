import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  dragging: css`
    will-change: transform;
    opacity: 0.5;
  `,
  fileItemDragOver: css`
    &,
    &:hover {
      background: ${cssVar.colorPrimaryBg};
    }

    outline: 1px dashed ${cssVar.colorPrimaryBorder};
    outline-offset: -2px;
  `,
  treeItem: css`
    cursor: pointer;
  `,
}));
