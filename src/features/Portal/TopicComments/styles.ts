import { createStaticStyles, cssVar } from 'antd-style';

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
    padding-block: 14px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};

    &:hover .topic-comment-actions {
      opacity: 1;
    }
  `,
  cardActions: css`
    position: absolute;
    inset-block-start: 8px;
    inset-inline-end: 0;

    opacity: 1;

    transition: opacity ${cssVar.motionDurationFast};

    @media (hover: hover) {
      opacity: 0;
    }
  `,
  composer: css`
    flex-shrink: 0;
    margin-block: 12px 16px;
    margin-inline: 16px;
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
  reply: css`
    margin-inline-start: 20px;
    padding-inline-start: 12px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));
