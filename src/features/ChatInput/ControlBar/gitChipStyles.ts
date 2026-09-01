import { createStaticStyles, cssVar } from 'antd-style';

/**
 * Chips shared by the live git status and by the snapshot that stands in for it
 * once the recorded directory is gone. Both render into the same composer bar,
 * so the separator and the PR chip must be pixel-identical — and `staleTrigger`,
 * the deliberately muted variant of `trigger`, lives next to the live one so the
 * two can't drift apart.
 */
export const gitChipStyles = createStaticStyles(({ css }) => ({
  prTrigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;

    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
    white-space: nowrap;

    transition: background 0.2s;

    &:hover {
      color: ${cssVar.colorText};
      background: ${cssVar.colorFillTertiary};
    }
  `,
  separator: css`
    flex: none;
    width: 1px;
    height: 10px;
    background: ${cssVar.colorSplit};
  `,
  // Muted so the snapshot never reads as live state, but still a control: the
  // recovery action is the only thing this cluster can still do.
  staleTrigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;

    max-width: 200px;
    padding-block: 2px;
    padding-inline: 4px;
    border-radius: 4px;

    font-size: 12px;
    color: ${cssVar.colorTextQuaternary};
    white-space: nowrap;

    transition: background 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  trigger: css`
    cursor: pointer;

    display: flex;
    flex: none;
    gap: 4px;
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
}));
