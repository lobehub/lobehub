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
  detailContent: css`
    align-self: center;
    width: min(100%, 960px);
    padding-block: 16px;
    padding-inline: 16px;
  `,
  titleInput: css`
    flex: 1;

    padding: 0;

    font-size: 28px;
    font-weight: 600;
    line-height: 1.3;
  `,

  // Parent bar
  parentBar: css`
    cursor: pointer;

    width: fit-content;
    padding-block: 4px;
    padding-inline: 10px;
    border-radius: 6px;

    transition: background 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  navItem: css`
    cursor: pointer;

    padding-block: 6px;
    padding-inline: 12px;
    border-radius: 6px;

    transition: background 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,

  // Subtasks
  subtaskHeader: css`
    cursor: pointer;
    padding-block: 6px;
  `,
  subtaskRow: css`
    cursor: pointer;

    display: flex;
    gap: 8px;
    align-items: center;

    min-height: 36px;
    padding-block: 6px;
    padding-inline-start: 22px;
    border-radius: 6px;

    transition: background 0.2s ${cssVar.motionEaseInOut};

    &:hover {
      background: ${cssVar.colorFillQuaternary};
    }
  `,
  subtaskCircle: css`
    flex-shrink: 0;

    width: 16px;
    height: 16px;
    border: 1.5px solid ${cssVar.colorTextQuaternary};
    border-radius: 50%;
  `,
  subtaskCircleDone: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    background: ${cssVar.colorSuccess};
  `,

  // Activities
  activityDivider: css`
    margin-block-start: 16px;
    padding-block: 10px;
    border-block-start: 1px solid ${cssVar.colorFillTertiary};
  `,
  activityItem: css`
    display: flex;
    gap: 10px;
    align-items: center;

    min-height: 36px;
    padding-block: 8px;
  `,
  activityAvatar: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
    border-radius: 50%;

    color: ${cssVar.colorTextQuaternary};

    background: ${cssVar.colorFillTertiary};
  `,
  commentBox: css`
    margin-block-start: 12px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 8px;
    transition: border-color 0.2s ${cssVar.motionEaseInOut};

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  commentInput: css`
    resize: none !important;
    padding-block: 12px !important;
    padding-inline: 14px !important;
  `,
  commentActions: css`
    display: flex;
    justify-content: flex-end;
    padding-block: 4px 8px;
    padding-inline: 10px;
  `,
}));
