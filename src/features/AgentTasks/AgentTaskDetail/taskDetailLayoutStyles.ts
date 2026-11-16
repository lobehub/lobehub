import { createStaticStyles, cssVar } from '@lobehub/ui';

// The sidebar takes 272px (rail + gap) off the reading column for the whole
// page, so it only appears once that column still has room for prose.
export const TASK_DETAIL_SIDEBAR_MIN_WIDTH = 880;

// The page's centered column when the sidebar is in: wide enough that the
// reading column beside the rail stays close to the default conversation width.
export const TASK_DETAIL_PAGE_WIDTH = 1080;

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
  // Title, sidebar and body share one grid so the sidebar runs beside the whole
  // page: sized by the title row alone, a tall sidebar pushed the instruction
  // down and left an empty band under the title.
  grid: css`
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: 16px;
    padding-block-start: 24px;

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      grid-template-columns: minmax(0, 1fr) ${SIDEBAR_WIDTH}px;
      grid-template-rows: auto 1fr;
      column-gap: 40px;
    }
  `,
  main: css`
    min-width: 0;
  `,
  side: css`
    min-width: 0;

    @container task-detail (width >= ${TASK_DETAIL_SIDEBAR_MIN_WIDTH}px) {
      position: sticky;
      inset-block-start: 24px;

      grid-column: 2;
      grid-row: 1 / span 2;
      align-self: start;

      padding-block-start: 8px;
    }
  `,
  // 36px under the header in both forms: the grid's 16px row gap plus this.
  body: css`
    min-width: 0;
    margin-block-start: 20px;
    padding-block-end: 120px;
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
    padding-inline: 8px;
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
