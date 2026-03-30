import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  dropZone: css`
    position: relative;
    height: 100%;
  `,
  dropZoneActive: css`
    background: ${cssVar.colorPrimaryBg};
    outline: 1px dashed ${cssVar.colorPrimaryBorder};
    outline-offset: -4px;
  `,
  header: css`
    min-width: 800px;
    height: 40px;
    min-height: 40px;
    color: ${cssVar.colorTextDescription};
  `,
  headerItem: css`
    height: 100%;
    padding-block: 6px;
    padding-inline: 0 24px;
  `,
  scrollContainer: css`
    overflow: auto hidden;
    flex: 1;
  `,
  selectAllHint: css`
    position: sticky;
    z-index: 1;
    inset-block-start: 40px;

    min-width: 800px;
    padding-block: 8px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: 12px;
    color: ${cssVar.colorTextDescription};

    background: ${cssVar.colorFillTertiary};
  `,
}));
