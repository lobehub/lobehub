import { createStaticStyles } from 'antd-style';

export const styles = createStaticStyles(({ css, cssVar }) => {
  return {
    container: css`
      position: relative;
      max-width: 100%;

      time,
      div[role='menubar'] {
        pointer-events: none;
        opacity: 0;
        transition: opacity 150ms ${cssVar.motionEaseOut};
      }

      time {
        display: inline-block;
        white-space: nowrap;
      }

      div[role='menubar'] {
        display: flex;
      }

      &:has([data-popup-open]) {
        div[role='menubar'] {
          pointer-events: unset;
          opacity: 1;
        }
      }

      &:hover {
        time,
        div[role='menubar'] {
          pointer-events: unset;
          opacity: 1;
        }
      }
    `,
    loading: css`
      position: absolute;
      inset-block-end: 0;
      inset-inline-start: -4px;

      width: 16px;
      height: 16px;
      border-radius: 8px;

      background: ${cssVar.colorPrimary};
      box-shadow: 0 0 8px color-mix(in srgb, ${cssVar.colorPrimary} 40%, transparent);
    `,
  };
});
