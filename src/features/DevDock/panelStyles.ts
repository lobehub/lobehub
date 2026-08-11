import { createStaticStyles, cssVar } from 'antd-style';

/** Shared flat workspace chrome for every panel mounted in DevDock. */
export const devDockPanelStyles = createStaticStyles(({ css }) => ({
  flatSection: css`
    flex-shrink: 0;
    padding: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  paneDividerEnd: css`
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  paneDividerStart: css`
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  paneHeader: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;

    height: 36px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    font-size: ${cssVar.fontSizeSM};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  paneSearch: css`
    display: flex;
    flex-shrink: 0;
    align-items: stretch;

    height: 44px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
  root: css`
    overflow: hidden;
    display: flex;
    flex-direction: column;

    width: 100%;
    height: 100%;
    min-height: 0;
  `,
  searchInput: css`
    flex: 1;

    height: 100%;
    border: 0 !important;
    border-radius: 0 !important;

    background: transparent !important;
    box-shadow: none !important;
  `,
  statusBar: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;

    height: 28px;
    padding-inline: 12px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  toolbar: css`
    display: flex;
    flex-shrink: 0;
    gap: 8px;
    align-items: center;

    height: 44px;
    padding-inline: 12px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));
