import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  // Task list page
  breadcrumb: css`
    padding-block: 12px;
    padding-inline: 16px;
  `,
  container: css`
    overflow-y: auto;
    flex: 1;
  `,
  content: css`
    align-self: center;
    width: min(100%, 960px);
    padding-block: 16px;
    padding-inline: 16px;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-block-end: 12px;
  `,
  switchGroup: css`
    display: flex;
    gap: 2px;

    padding: 2px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 6px;
  `,

  // Task detail page
  activityItem: css`
    padding-block: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  detailContent: css`
    align-self: center;
    width: min(100%, 960px);
    padding-block: 16px;
    padding-inline: 16px;
  `,
  section: css`
    margin-block-start: 24px;
  `,
  sectionTitle: css`
    margin-block-end: 12px;
    font-size: 16px;
    font-weight: 600;
  `,
  subtaskItem: css`
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: space-between;

    padding-block: 8px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  titleInput: css`
    flex: 1;
    font-size: 28px;
    font-weight: 500;
    line-height: 1.4;
  `,
}));
