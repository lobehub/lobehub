import { createStaticStyles } from 'antd-style';

export const ICON_SIZE = 56;

export const styles = createStaticStyles(({ css, cssVar }) => ({
  authorLink: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    color: ${cssVar.colorPrimary};

    &:hover {
      text-decoration: underline;
    }
  `,
  code: css`
    font-family: ${cssVar.fontFamilyCode};
  `,
  detailItem: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  detailLabel: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  header: css`
    display: flex;
    gap: 16px;
    align-items: center;
    border-radius: 12px;

    /* background: ${cssVar.colorFillTertiary}; */
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: ${ICON_SIZE}px;
    height: ${ICON_SIZE}px;
  `,
  introduction: css`
    font-size: 14px;
    line-height: 1.8;
    color: ${cssVar.colorText};
  `,
  nav: css`
    border-block-end: 1px solid ${cssVar.colorBorder};
  `,
  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  title: css`
    font-size: 18px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  trustWarning: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
  `,
}));
