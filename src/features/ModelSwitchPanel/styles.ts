import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  dropdown: css`
    overflow: hidden;

    width: 100%;
    height: 100%;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgElevated};
    box-shadow: ${cssVar.boxShadowSecondary};
  `,
  footer: css`
    position: sticky;
    z-index: 10;
    inset-block-end: 0;

    padding-block: 6px;
    padding-inline: 0;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgElevated};
  `,
  footerButton: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    box-sizing: border-box;
    margin-inline: 8px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    color: ${cssVar.colorTextSecondary};

    transition: all 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  groupHeader: css`
    margin-inline: 8px;
    padding-block: 6px;
    padding-inline: 8px;
    color: ${cssVar.colorTextSecondary};
  `,
  menuItem: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    box-sizing: border-box;
    margin-inline: 8px;
    padding-block: 6px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    white-space: nowrap;

    &:hover {
      background: ${cssVar.colorFillTertiary};

      .settings-icon {
        opacity: 1;
      }
    }
  `,
  menuItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  settingsIcon: css`
    opacity: 0;
  `,
  submenu: css`
    .ant-dropdown-menu {
      padding: 4px;
    }

    .ant-dropdown-menu-item {
      margin-inline: 0;
      padding-block: 6px;
      padding-inline: 8px;
      border-radius: ${cssVar.borderRadiusSM};
    }

    .ant-dropdown-menu-item-group-title {
      padding-block: 6px;
      padding-inline: 8px;
      font-size: 12px;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  tag: css`
    cursor: pointer;
  `,
  toolbar: css`
    position: sticky;
    z-index: 10;
    inset-block-start: 0;

    display: flex;
    align-items: center;
    justify-content: space-between;

    padding-block: 6px;
    padding-inline: 8px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    background: ${cssVar.colorBgElevated};
  `,
  toolbarModelName: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
