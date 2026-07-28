import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  card: css`
    &:hover {
      border-color: ${cssVar.colorBorder} !important;
    }

    &:hover .task-template-dismiss {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  compactRow: css`
    cursor: pointer;

    margin-inline: -8px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:hover .task-template-dismiss {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  compactTitle: css`
    min-width: 0;
  `,
  dismissBtn: css`
    pointer-events: none;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  `,
}));
