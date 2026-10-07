import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  breadcrumbLink: css`
    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  caseIndex: css`
    flex: none;

    width: 28px;
    padding-block-start: 1px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextQuaternary};
  `,
  caseInput: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: ${cssVar.fontSize};
    line-height: 1.5;
    color: ${cssVar.colorText};
    overflow-wrap: anywhere;
  `,
  caseRow: css`
    cursor: pointer;

    padding-block: 12px;
    padding-inline: 16px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    color: inherit;
    text-decoration: none;

    transition: background 0.15s ease;

    &:last-child {
      border-block-end: none;
    }

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }

    &:focus-visible {
      outline: 2px solid ${cssVar.colorPrimary};
      outline-offset: -2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `,
  chip: css`
    display: inline-flex;
    gap: 4px;
    align-items: center;

    font-size: ${cssVar.fontSizeSM};
    line-height: 20px;
    color: ${cssVar.colorTextTertiary};
    white-space: nowrap;
  `,
  icon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  linkButton: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    padding: 0;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    line-height: 20px;
    color: ${cssVar.colorTextTertiary};

    background: transparent;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:disabled {
      cursor: progress;
    }
  `,
  list: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorTextTertiary};
  `,
  metaDot: css`
    color: ${cssVar.colorTextQuaternary};
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
  `,
  muted: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  rate: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  `,
  rateTrack: css`
    overflow: hidden;
    flex: none;

    width: 64px;
    height: 4px;
    border-radius: 999px;

    background: ${cssVar.colorFillSecondary};
  `,
  waysGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;

    width: 100%;
    max-width: 560px;
  `,
  way: css`
    padding: 12px;
    border-radius: ${cssVar.borderRadius};
    text-align: start;
    background: ${cssVar.colorFillQuaternary};
  `,
  wayTitle: css`
    font-size: ${cssVar.fontSize};
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
}));
