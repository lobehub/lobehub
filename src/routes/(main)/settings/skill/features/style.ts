import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  connected: css`
    font-size: 12px;
    color: ${cssVar.colorSuccess};
  `,
  container: css`
    padding-block: 6px;
    padding-inline: 4px;
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
  icon: css`
    overflow: hidden;
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 20px;
    height: 20px;
    border-radius: 4px;
  `,
  pending: css`
    font-size: 12px;
    color: ${cssVar.colorWarning};
  `,
  title: css`
    cursor: pointer;
    font-size: 14px;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));
