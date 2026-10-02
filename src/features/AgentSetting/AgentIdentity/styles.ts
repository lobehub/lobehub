import { createStaticStyles, cssVar } from 'antd-style';

/**
 * Shared surfaces for the identity tab.
 *
 * Filled-and-rounded rather than outlined: a border here would read as a
 * card-inside-a-card boundary (the settings panel is already the container),
 * and the accounts are a list of peers, not separate panels.
 */
export const identityStyles = createStaticStyles(({ css }) => ({
  card: css`
    padding-block: 12px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};
    background: ${cssVar.colorFillQuaternary};
  `,
  empty: css`
    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorTextTertiary};
    text-align: center;
  `,
  icon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextSecondary};
  `,
  inboxRow: css`
    cursor: pointer;

    padding-block: 10px;
    padding-inline: 14px;
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  sectionHeader: css`
    display: flex;
    gap: 12px;
    align-items: baseline;
    justify-content: space-between;
  `,
  subject: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  unreadDot: css`
    flex-shrink: 0;

    width: 7px;
    height: 7px;
    border-radius: 50%;

    background: ${cssVar.colorPrimary};
  `,
}));
