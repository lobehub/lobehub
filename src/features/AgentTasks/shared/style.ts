import { createStaticStyles } from '@lobehub/ui';

import { densityVars } from '@/styles/densityVars';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  breadcrumb: css`
    overflow: hidden;
    min-width: 0;

    ol {
      flex-wrap: nowrap;
      align-items: center;
      min-width: 0;
    }

    li {
      overflow: hidden;
      display: flex;
      flex-shrink: 1;
      align-items: center;

      min-width: 0;
    }

    li > [aria-hidden='true'] {
      overflow: visible;
      flex-shrink: 0;
      min-width: auto;
      margin-inline: 2px;
    }

    li > :not([aria-hidden='true']) {
      overflow: hidden;
      display: flex;
      align-items: center;

      min-width: 0;
      padding-block: 2px;
      padding-inline: 6px;
      border-radius: ${cssVar.borderRadius};
    }
  `,

  subtaskTreeTitle: css`
    color: ${cssVar.colorTextSecondary};
  `,

  /**
   * One line of the activity timeline. The rail is drawn per line so a run of
   * lines joins up; the first and last line of a run only draw their inner
   * half, so the rail starts and ends at a mark.
   */
  activityLine: css`
    position: relative;

    /*
     * Inset so the 16px mark is centred under the 24px avatar inside a comment
     * card (8px card padding + 12px to the avatar's centre): the rail and the
     * faces in the cards sit on one vertical line, the cards just run wider.
     */
    padding-block: 5px;
    padding-inline-start: ${densityVars.contentGap};

    &::before {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 19.5px;

      width: 1px;

      background: ${cssVar.colorBorderSecondary};
    }

    &:first-child::before {
      inset-block-start: 50%;
    }

    &:last-child::before {
      inset-block-end: 50%;
    }

    &:only-child::before {
      display: none;
    }
  `,

  /** The 16px mark on the rail: a type icon or a face. Opaque so it covers the rail. */
  activityMark: css`
    position: relative;
    z-index: 1;

    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 16px;
    height: 16px;
    border-radius: 50%;

    background: ${cssVar.colorBgContainer};
  `,

  /** A run of adjacent lines; cancels the feed's card gap so they sit tight. */
  activityTimeline: css`
    margin-block: -4px;
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

  /**
   * A comment on the activity rail. No card: the author's 24px face sits on
   * the same vertical line as the 16px marks of the lines around it (8px in +
   * 12px to its centre = the rail's 19.5px), and the body indents under the
   * name. Its slice of the rail runs from the face's centre, so the rail meets
   * the face instead of overshooting the first or last item of a run.
   */
  commentLine: css`
    position: relative;

    padding-block: 8px;
    padding-inline-start: 8px;

    &::before {
      content: '';

      position: absolute;
      inset-block: 0;
      inset-inline-start: 19.5px;

      width: 1px;

      background: ${cssVar.colorBorderSecondary};
    }

    &:first-child::before {
      inset-block-start: 20px;
    }

    &:last-child::before {
      inset-block-end: calc(100% - 20px);
    }

    &:only-child::before {
      display: none;
    }
  `,

  profileAuthorName: css`
    cursor: pointer;
    transition: color 0.15s ease;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
}));
