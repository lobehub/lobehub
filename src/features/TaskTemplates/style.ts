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
  dismissBtn: css`
    pointer-events: none;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.15s;
  `,
  iconBadge: css`
    flex-shrink: 0;

    width: 36px;
    height: 36px;
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};
  `,
}));
