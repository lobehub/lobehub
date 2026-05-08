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
  meta: css`
    display: flex;
    gap: 4px;
    align-items: center;
    color: ${cssVar.colorTextTertiary};
  `,
  optionalHintBtn: css`
    cursor: pointer;

    margin: 0;
    padding: 0;
    border: none;

    color: ${cssVar.colorTextTertiary};
    text-decoration: underline;

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusSM};
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: 2px;
    }
  `,
}));
