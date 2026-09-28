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

    .hierarchy-node-actions {
      opacity: 0;
      transition: opacity 0.15s;
    }

    /* Hover, keyboard focus on the action itself, or an open menu keep it visible. */
    &:hover .hierarchy-node-actions,
    .hierarchy-node-actions:focus-within,
    .hierarchy-node-actions[data-open='true'] {
      opacity: 1;
    }
  `,
}));
