import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  header: css`
    flex-shrink: 0;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
    background: ${cssVar.colorBgContainer};
  `,
  left: css`
    overflow: hidden;
    min-width: 0;
  `,
  right: css`
    flex-shrink: 0;
  `,
  tabs: css`
    overflow-x: auto;
    width: auto;
    min-width: 0;
    max-width: 100%;
  `,
  tabsList: css`
    gap: 0;
    min-width: max-content;
  `,
  tab: css`
    padding-inline: 8px;

    &:focus-visible {
      outline-offset: -2px;
    }
  `,
  title: css`
    overflow: hidden;

    max-width: 160px;

    font-size: 13px;
    font-weight: 500;
    line-height: 1.4;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
