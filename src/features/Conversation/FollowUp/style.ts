import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-start;

    max-inline-size: 460px;
    margin-block-start: 8px;
    margin-inline-start: 44px;
  `,
  chip: css`
    cursor: pointer;

    display: inline-flex;
    gap: 8px;
    align-items: center;

    padding-block: 7px;
    padding-inline: 10px 14px;
    border: none;
    border-radius: 8px;

    font-size: 13px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillTertiary};

    transition:
      background 0.15s,
      color 0.15s;

    &:hover {
      background: ${cssVar.colorFillSecondary};
    }

    &:hover .followup-icon {
      color: ${cssVar.colorPrimary};
      opacity: 1;
    }
  `,
  chipIcon: css`
    flex: none;
    opacity: 0.55;
    transition:
      opacity 0.15s,
      color 0.15s;
  `,
}));
