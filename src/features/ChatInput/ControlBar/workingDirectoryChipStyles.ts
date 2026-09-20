import { createStaticStyles, cssVar } from 'antd-style';

/**
 * The composer's working-directory chip — for a run on a machine and for one in
 * the cloud sandbox. One declaration, because the two stand in the same slot
 * and are read as one control: a second copy drifts (a darker hover here, a
 * wider gap there) into looking like a different kind of thing.
 */
export const workingDirectoryChipStyles = createStaticStyles(({ css }) => ({
  chip: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 6px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  label: css`
    overflow: hidden;
    max-width: 140px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));
