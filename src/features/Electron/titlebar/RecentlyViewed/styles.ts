import { createStaticStyles } from 'antd-style';

export const useStyles = createStaticStyles(({ css, cssVar }) => ({
  actionIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
    opacity: 0;
    transition: opacity 0.2s ${cssVar.motionEaseOut};
  `,
  container: css`
    overflow-y: auto;
    width: 260px;
    max-height: 320px;
    padding: 4px;
  `,
  divider: css`
    height: 1px;
    margin-block: 4px;
    background-color: ${cssVar.colorBorderSecondary};
  `,
  empty: css`
    padding-block: 16px;
    padding-inline: 12px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  item: css`
    cursor: default;

    overflow: hidden;
    flex-shrink: 0;

    padding-block: 3px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    transition: background-color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillSecondary};
    }

    &:hover .actionIcon {
      color: ${cssVar.colorText};
      opacity: 1;
    }
  `,
  itemActive: css`
    background-color: ${cssVar.colorFillTertiary};

    &:hover {
      background-color: ${cssVar.colorFillSecondary};
    }
  `,
  itemHovered: css`
    background-color: ${cssVar.colorFillSecondary};
  `,
  itemTitle: css`
    overflow: hidden;
    flex: 1;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    padding-block: 4px;
    padding-inline: 8px;

    font-size: 11px;
    font-weight: 500;
    color: ${cssVar.colorTextTertiary};
    text-transform: capitalize;
    letter-spacing: 0.5px;
  `,
}));
