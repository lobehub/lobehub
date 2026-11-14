import { createStaticStyles, cssVar } from '@lobehub/ui';

export const styles = createStaticStyles(({ css }) => ({
  anchor: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 10px;
    border-inline-start: 2px solid ${cssVar.colorBorder};
    border-radius: 0 ${cssVar.borderRadius} ${cssVar.borderRadius} 0;

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillQuaternary};

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }

    &[aria-disabled='true'] {
      cursor: default;

      &:hover {
        color: ${cssVar.colorTextSecondary};
        background: ${cssVar.colorFillQuaternary};
      }
    }
  `,
  body: css`
    overflow: hidden;
    flex: 1;
    min-height: 0;
  `,
  card: css`
    position: relative;
    padding-block: 12px;

    &:hover .topic-comment-actions,
    &:focus-within .topic-comment-actions {
      opacity: 1;
    }
  `,
  cardActions: css`
    position: absolute;
    inset-block-start: 12px;
    inset-inline-end: 0;

    opacity: 1;

    transition: opacity ${cssVar.motionDurationFast};

    @media (hover: hover) {
      opacity: 0;
    }
  `,
  /** Independent threads in the list: a hairline between neighbours, none after the last. */
  cardDivided: css`
    & + & {
      border-block-start: 1px solid ${cssVar.colorBorderSecondary};
    }
  `,
  /** Left-aligned under the content; pulled out so the icon lines up with the text column. */
  cardFooter: css`
    margin-inline-start: -8px;
    color: ${cssVar.colorTextSecondary};
  `,
  composer: css`
    flex-shrink: 0;
    margin-block: 8px 16px;
    margin-inline: 16px;
  `,
  composerEditor: css`
    flex: 1;
    min-width: 0;
    padding-block: 2px;
  `,
  /** One row like a chat app: the input grows with its content, Send sits at its last line. */
  composerRow: css`
    display: flex;
    gap: 8px;
    align-items: flex-end;

    min-height: 44px;
    padding-block: 8px;
    padding-inline: 12px 8px;
  `,
  /**
   * Mentions render as plain coloured text here, so the chip's own inset would
   * push a line-leading mention off the text column.
   */
  content: css`
    min-width: 0;

    .editor_mention {
      margin-inline: 0;
      padding-inline: 0;
    }
  `,
  deleted: css`
    font-style: italic;
    color: ${cssVar.colorTextTertiary};
  `,
  editEditor: css`
    padding-block: 8px;
    padding-inline: 10px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: ${cssVar.borderRadius};

    background: ${cssVar.colorBgContainer};

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
    }
  `,
  edited: css`
    color: ${cssVar.colorTextTertiary};
  `,
  empty: css`
    flex: 1;
    min-height: 240px;
  `,
  list: css`
    overflow-y: auto;
    overscroll-behavior: contain;
    flex: 1;

    min-height: 0;
    padding-inline: 16px;
  `,
  moderatedContent: css`
    opacity: 0.62;
  `,
  /** "3 replies" followed by a rule: the one line that separates the comment from its replies. */
  repliesDivider: css`
    display: flex;
    gap: 12px;
    align-items: center;

    margin-block: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextTertiary};

    &::after {
      content: '';
      flex: 1;
      height: 1px;
      background: ${cssVar.colorBorderSecondary};
    }
  `,
}));
