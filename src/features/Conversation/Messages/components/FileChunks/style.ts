import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  badge: css`
    padding-block: 4px;
    padding-inline: 6px;
    border-radius: 2222px;

    font-size: 12px;
    line-height: 12px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,

  container: css`
    cursor: pointer;

    width: fit-content;
    padding-block: 6px;
    padding-inline: 8px;
    padding-inline-end: 12px;
    border-radius: 8px;

    color: ${cssVar.colorText};

    background: color-mix(in srgb, ${cssVar.colorBgElevated} 90%, white);
    box-shadow: ${cssVar.boxShadowTertiary};

    transition: all 0.2s;

    &:hover {
      box-shadow: ${cssVar.boxShadowSecondary};
    }
  `,
  containerDark: css`
    &:hover {
      background: color-mix(in srgb, ${cssVar.colorBgElevated} 85%, white);
    }
  `,
  containerLight: css`
    &:hover {
      background: '';
    }
  `,
  filename: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-size: 12px;
    text-overflow: ellipsis;
  `,

  mobile: css`
    width: 100%;
  `,
}));
