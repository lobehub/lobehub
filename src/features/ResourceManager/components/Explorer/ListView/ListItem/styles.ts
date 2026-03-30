import { createStaticStyles, cssVar } from 'antd-style';

export const styles = createStaticStyles(({ css }) => ({
  container: css`
    position: relative;
    cursor: pointer;
    min-width: 800px;

    &::after {
      content: '';

      position: absolute;
      z-index: 0;
      inset: 0;

      background-color: ${cssVar.colorFillTertiary};
      opacity: 0;
      pointer-events: none;
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

    &,
    &:hover {
      &::after {
        background-color: ${cssVar.colorPrimaryBg};
        opacity: 1;
      }
    }

    &::before {
      opacity: 0;
    }
  `,

  dragging: css`
    will-change: transform;
    opacity: 0.5;
  `,

  evenRow: css`
    &::before {
      content: '';

      position: absolute;
      z-index: 0;
      inset: 0;

      background-color: ${cssVar.colorFillQuaternary};
      pointer-events: none;

      opacity: 1;
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
      background-color: ${cssVar.colorFillTertiary};
      opacity: 1;
    }

    &:hover {
      &::after {
        background-color: ${cssVar.colorFillSecondary};
      }
    }
  `,
}));
