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
    margin-inline: -8px;
    padding-inline-end: 4px;
    border-radius: ${cssVar.borderRadius};
    transition: background ${cssVar.motionDurationFast};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:hover .task-template-dismiss,
    &:focus-within .task-template-dismiss {
      pointer-events: auto;
      opacity: 1;
    }
  `,
  compactMain: css`
    flex: 1;
    justify-content: flex-start;

    height: auto;
    padding-block: 6px;
    padding-inline: 8px 4px;
    border: 0;

    text-align: start;
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
