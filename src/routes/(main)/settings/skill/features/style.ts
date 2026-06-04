import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  connected: css`
    font-size: 14px;
    color: ${cssVar.colorSuccess};
  `,
  container: css`
    padding-block: 6px;
    padding-inline: 0;
  `,
  disconnected: css`
    font-size: 14px;
    color: ${cssVar.colorTextTertiary};
  `,
  disconnectedIcon: css`
    opacity: 0.5;
  `,
  disconnectedTitle: css`
    opacity: 0.5;
  `,
  error: css`
    font-size: 14px;
    color: ${cssVar.colorError};
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 36px;
    height: 36px;
    border-radius: 8px;

    background: ${cssVar.colorFillTertiary};
  `,
  pending: css`
    font-size: 14px;
    color: ${cssVar.colorWarning};
  `,
  title: css`
    cursor: pointer;
    font-size: 15px;
    font-weight: 500;
    color: ${cssVar.colorText};

    &:hover {
      color: ${cssVar.colorPrimary};
    }
  `,
}));
