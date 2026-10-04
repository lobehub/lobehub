import { createStaticStyles } from 'antd-style';

/**
 * Page chrome shared by the dashboard pages (board list, one board, a
 * project's dashboards): a wide canvas — a board is read at a glance, so it
 * gets the width the chat column does not need — and one heading scale.
 */
export const dashboardPageStyles = createStaticStyles(({ css, cssVar, responsive }) => ({
  canvas: css`
    display: flex;
    flex-direction: column;
    gap: 24px;

    width: 100%;
    max-width: 1440px;
    margin-inline: auto;
    padding-block: 24px 48px;
    padding-inline: 32px;

    ${responsive.sm} {
      gap: 16px;
      padding-block: 16px 32px;
      padding-inline: 16px;
    }
  `,
  description: css`
    max-width: 72ch;
    color: ${cssVar.colorTextSecondary};
  `,
  heading: css`
    ${responsive.sm} {
      flex-direction: column;
      align-items: stretch;
    }
  `,
  scroll: css`
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  `,
  sectionTitle: css`
    margin: 0;

    font-size: 15px;
    font-weight: 600;
    line-height: 1.4;
    color: ${cssVar.colorText};
  `,
  title: css`
    margin: 0;

    font-size: 22px;
    font-weight: 600;
    line-height: 1.3;
    color: ${cssVar.colorText};
    letter-spacing: -0.01em;
  `,
}));
