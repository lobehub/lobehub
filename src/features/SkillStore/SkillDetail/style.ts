import { createStaticStyles, responsive } from 'antd-style';

export const agentListStyles = createStaticStyles(({ css }) => ({
  item: css`
    width: calc(50% - 6px);

    ${responsive.sm} {
      width: 100%;
    }
  `,
  list: css`
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding-block-end: 16px;
  `,
}));

export const itemStyles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    position: relative;
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,
  description: css`
    overflow: hidden;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  title: css`
    overflow: hidden;

    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
