import { createStaticStyles, cssVar } from '@lobehub/ui';

export const TASK_DETAIL_SIDEBAR_MIN_WIDTH = 720;

const SIDEBAR_WIDTH = 232;

// One header, two forms, chosen by the column width rather than the viewport:
// the same sections mount in the full page, the chat-side Portal and beside
// the task-agent panel. Wide columns get a Linear-style properties sidebar;
// narrow ones fold the same triggers into a pill row under the title.
export const taskDetailLayoutStyles = createStaticStyles(({ css }) => ({
  root: css`
    container-name: task-detail;
    container-type: inline-size;
  `,
  header: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 16px;
    padding-block: 24px 36px;

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      grid-template-columns: minmax(0, 1fr) ${SIDEBAR_WIDTH}px;
      column-gap: 40px;
    }
  `,
  main: css`
    min-width: 0;
  `,
  side: css`
    min-width: 0;

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      grid-column: 2;
      grid-row: 1;
      padding-block-start: 8px;
    }
  `,
  properties: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;

    max-width: 100%;

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      flex-direction: column;
      gap: 20px;
      align-items: stretch;
    }
  `,
  // Properties, Labels and Project are titled groups in the sidebar, as in
  // Linear. The pill row has no room for titles, so there each group dissolves
  // into the row and its triggers flow as before.
  propertyGroup: css`
    display: contents;

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
  `,
  propertyGroupTitle: css`
    display: none;

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      display: block;

      margin-block-end: 4px;
      padding-inline: 8px;

      font-size: 12px;
      font-weight: 500;
      line-height: 20px;
      color: ${cssVar.colorTextDescription};
    }
  `,
  propertyItem: css`
    max-width: 100%;
    height: 28px;
    padding-inline: 8px 10px;
    border-radius: ${cssVar.borderRadius};

    white-space: nowrap;

    background: ${cssVar.colorFillTertiary};

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      width: 100%;
      height: 30px;
      background: transparent;
    }
  `,
}));
