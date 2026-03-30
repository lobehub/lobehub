import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  container: css`
    cursor: pointer;
    position: relative;
    min-width: 800px;

    &::after {
      pointer-events: none;
      content: '';

      position: absolute;
      z-index: 0;
      inset: 0;

      opacity: 0;
      background-color: ${cssVar.colorFillTertiary};

      transition:
        opacity ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut},
        background-color ${cssVar.motionDurationMid} ${cssVar.motionEaseInOut};
    }

    > * {
      position: relative;
      z-index: 1;
    }

    &:hover {
      &::after {
        opacity: 1;
      }
    }
  `,

  dragOver: css`
    outline: 1px dashed ${cssVar.colorPrimaryBorder};
    outline-offset: -2px;

    &::before {
      opacity: 0;
    }

    &,
    &:hover {
      &::after {
        opacity: 1;
        background-color: ${cssVar.colorPrimaryBg};
      }
    }
  `,

  dragging: css`
    will-change: transform;
    opacity: 0.5;
  `,

  evenRow: css`
    &::before {
      pointer-events: none;
      content: '';

      position: absolute;
      z-index: 0;
      inset: 0;

      opacity: 1;
      background-color: ${cssVar.colorFillQuaternary};

      transition: opacity 300ms ${cssVar.motionEaseInOut};
    }

    &:hover {
      &::before {
        opacity: 0;
      }
    }

    .list-view-drop-zone:hover & {
      &::before {
        opacity: 0;
      }
    }
  `,

  hover: css`
    opacity: 0;

    &[data-popup-open],
    .file-list-item-group:hover & {
      opacity: 1;
    }
  `,

  item: css`
    padding-block: 0;
    padding-inline: 0 24px;
    color: ${cssVar.colorTextSecondary};
  `,

  name: css`
    overflow: hidden;
    flex: 1;

    min-width: 0;
    margin-inline-start: 12px;

    color: ${cssVar.colorText};
    white-space: nowrap;
  `,

  nameContainer: css`
    overflow: hidden;
    flex: 1;
    min-width: 0;
  `,

  selected: css`
    &::before {
      opacity: 0;
    }

    &::after {
      opacity: 1;
      background-color: ${cssVar.colorFillTertiary};
    }

    &:hover {
      &::after {
        background-color: ${cssVar.colorFillSecondary};
      }
    }
  `,
}));
