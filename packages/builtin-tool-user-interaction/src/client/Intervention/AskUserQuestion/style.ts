import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  escapeLink: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding-block: 4px;
    padding-inline: 0;

    font-size: 13px;

    transition: color ${cssVar.motionDurationMid};

    &:hover {
      color: ${cssVar.colorPrimary} !important;
    }
  `,
}));
