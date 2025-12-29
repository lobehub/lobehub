import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  memberItem: css`
    cursor: pointer;

    display: flex;
    flex-direction: row;
    gap: 4px;
    align-items: center;

    width: 100%;
    min-height: 36px;
    max-height: 36px;
    padding-block: 0 !important;
    padding-inline: 4px !important;
    border-radius: ${cssVar.borderRadius};

    transition: all 0.2s ease;

    .show-on-hover {
      opacity: 0;
    }

    &:hover {
      background: ${cssVar.colorFillTertiary};

      .show-on-hover {
        opacity: 1;
      }
    }
  `,
  prompt: css`
    opacity: 0.75;
    transition: opacity 200ms ${cssVar.motionEaseOut};

    &:hover {
      opacity: 1;
    }
  `,
}));
