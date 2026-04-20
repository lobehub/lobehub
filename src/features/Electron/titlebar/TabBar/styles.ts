import { createStaticStyles } from 'antd-style';

export const useStyles = createStaticStyles(({ css, cssVar }) => ({
  avatarWrapper: css`
    position: relative;
    flex-shrink: 0;
    line-height: 0;
  `,
  closeIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  runningDot: css`
    position: absolute;
    inset-block-end: -2px;
    inset-inline-end: -2px;

    width: 8px;
    height: 8px;
    border: 1.5px solid ${cssVar.colorBgLayout};
    border-radius: 50%;

    background: ${cssVar.gold};
    box-shadow: 0 0 6px ${cssVar.gold};
  `,
  unreadDot: css`
    position: absolute;
    inset-block-end: -2px;
    inset-inline-end: -2px;

    width: 8px;
    height: 8px;
    border: 1.5px solid ${cssVar.colorBgLayout};
    border-radius: 50%;

    background: ${cssVar.colorInfo};
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
    padding-inline-start: 10px;
    border-radius: ${cssVar.borderRadiusSM};

    font-size: 12px;

    background-color: transparent;

    transition: background-color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
  tabActive: css`
    background-color: ${cssVar.colorBgContainer};

    &:hover {
      background-color: ${cssVar.colorBgContainer};
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
  newTabButton: css`
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 26px;
    height: 22px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};

    transition:
      background-color 0.15s ${cssVar.motionEaseInOut},
      color 0.15s ${cssVar.motionEaseInOut};

    &:hover {
      color: ${cssVar.colorText};
      background-color: ${cssVar.colorFillTertiary};
    }
  `,
}));
