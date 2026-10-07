import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  breadcrumb: css`
    font-size: ${cssVar.fontSizeSM};

    a {
      color: ${cssVar.colorTextTertiary};
      text-decoration: none;
      transition: color 0.15s ease;

      &:hover {
        color: ${cssVar.colorText};
      }
    }
  `,
  card: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorBgContainer};
  `,
  clamp: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;

    word-break: break-word;
    white-space: pre-wrap;
  `,
  configItem: css`
    min-width: 0;
  `,
  configLabel: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  configValue: css`
    overflow: hidden;

    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  divider: css`
    height: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  excerpt: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;

    font-size: ${cssVar.fontSizeSM};
    line-height: ${cssVar.lineHeightSM};
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
  `,
  label: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  linkButton: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;
    align-self: flex-start;

    padding: 0;
    border: none;

    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};

    background: none;

    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  mono: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    font-variant-numeric: tabular-nums;
  `,
  prose: css`
    overflow-y: auto;

    max-height: 240px;
    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    font-size: ${cssVar.fontSize};
    line-height: ${cssVar.lineHeight};
    word-break: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorFillQuaternary};
  `,
  resultRow: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: ${cssVar.borderRadius};

    transition: background 0.15s ease;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  sectionTitle: css`
    margin: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
  `,
  stat: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    line-height: 1.2;
  `,
}));
