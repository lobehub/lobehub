import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  analyzeAction: css`
    position: relative;

    display: inline-flex;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
  `,
  analyzeProgress: css`
    pointer-events: none;

    position: absolute;
    z-index: 1;
    inset: 0;
    transform: rotate(-90deg);
  `,
  editorColumn: css`
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
  `,
  proposalCard: css`
    padding: 10px;
    border: 1px dashed ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  sectionHeader: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  sidecarCard: css`
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));
