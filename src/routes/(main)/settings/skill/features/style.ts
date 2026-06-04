import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  connected: css`
    font-size: 12px;
    color: ${cssVar.colorSuccess};
  `,
  container: css`
    padding-block: 3px;
    padding-inline: 0;
  `,
  disconnected: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  disconnectedIcon: css`
    opacity: 0.4;
  `,
  disconnectedTitle: css`
    opacity: 0.5;
  `,
  error: css`
    font-size: 12px;
    color: ${cssVar.colorError};
  `,
  /* No background — just the avatar/icon itself, matching reference design */
  icon: css`
    overflow: hidden;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 6px;
  `,
  pending: css`
    font-size: 12px;
    color: ${cssVar.colorWarning};
  `,
  title: css`
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));
