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
  columnHeader: css`
    flex: none;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  editorColumn: css`
    width: 100%;
    max-width: 720px;
    margin-inline: auto;
  `,
  section: css`
    padding-block: 12px;
    padding-inline: 16px;
  `,
  sidecarCard: css`
    padding-block: 8px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
}));
