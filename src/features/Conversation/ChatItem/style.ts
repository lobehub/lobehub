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
        transition: opacity 200ms ${cssVar.motionEaseOut};
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
      inset-inline-end: unset;

      width: 16px;
      height: 16px;
      border-radius: 50%;

      color: ${cssVar.colorBgLayout};

      background: ${cssVar.colorPrimary};
    `,
  };
});
