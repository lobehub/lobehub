import { createStaticStyles } from 'antd-style';

export const useStyles = createStaticStyles(({ css, cssVar }) => ({
  closeIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
    opacity: 0;
    transition: opacity 0.15s ${cssVar.motionEaseOut};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  container: css`
    flex: 1;
    min-width: 0;
    border-radius: 0;
    background: transparent;
  `,
  tab: css`
    cursor: default;
    user-select: none;

    position: relative;

    overflow: hidden;
    flex-shrink: 0;

    width: 180px;
    padding-block: 2px;
    padding-inline: 10px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;

    background-color: ${cssVar.colorFillTertiary};

    transition: background-color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillSecondary};
    }

    &:hover .closeIcon {
      opacity: 1;
    }
  `,
  tabActive: css`
    background-color: ${cssVar.colorFillSecondary};

    &:hover {
      background-color: ${cssVar.colorFill};
    }

    & .closeIcon {
      opacity: 1;
    }
  `,
  tabIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  tabTitle: css`
    overflow: hidden;
    flex: 1;

    font-size: 12px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
