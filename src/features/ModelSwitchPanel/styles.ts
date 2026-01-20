import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    padding: 0 !important;
  `,
  dropdownMenu: css`
    [role='menuitem'] {
      margin-block: 1px;
      margin-inline: 4px;
      padding-block: 8px;
      padding-inline: 8px;
      border-radius: ${cssVar.borderRadiusSM};
    }

    [role='menuitem'] .settings-icon {
      opacity: 0;
    }

    [role='menuitem']:hover .settings-icon {
      opacity: 1;
    }
  `,

  footer: css`
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  groupHeader: css`
    width: 100%;
    color: ${cssVar.colorTextSecondary};

    .settings-icon {
      opacity: 0;
    }

    &:hover {
      .settings-icon {
        opacity: 1;
      }
    }
  `,
  list: css`
    position: relative;
    overflow: hidden auto;
    width: 100%;
  `,
  menuItem: css`
    cursor: pointer;

    position: relative;

    gap: 8px;
    align-items: center;

    margin-block: 1px;
    margin-inline: 4px;
    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadiusSM};

    .settings-icon {
      opacity: 0;
    }

    &:hover {
      .settings-icon {
        opacity: 1;
      }
    }
  `,
  menuItemActive: css`
    background: ${cssVar.colorFillTertiary};
  `,
  toolbar: css`
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));
