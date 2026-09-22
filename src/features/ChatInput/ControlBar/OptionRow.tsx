'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CheckIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

/**
 * One choice in a composer menu: framed icon, title over a description, and a
 * check when it is the current one.
 *
 * Shared rather than copied because these menus sit next to each other in the
 * same bar and are read as one control surface — a second copy of the styles
 * would drift into looking like a different kind of thing.
 */
const styles = createStaticStyles(({ css }) => ({
  check: css`
    flex: none;
    margin-inline-start: auto;
    color: ${cssVar.colorPrimary};
  `,
  desc: css`
    display: flex;
    gap: 6px;
    align-items: center;

    font-size: 11px;
    color: ${cssVar.colorTextDescription};
  `,
  extra: css`
    display: flex;
    flex: none;
    gap: 4px;
    align-items: center;

    margin-inline-start: auto;

    /* A disabled row dims itself, but its trailing action is the way OUT of
       that state — dimming the setup button would read as "also unavailable". */
    opacity: 1;
  `,
  option: css`
    cursor: pointer;

    display: flex;
    gap: 10px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 8px;
    border-radius: ${cssVar.borderRadius};

    transition: background-color 0.2s;

    &:hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  optionActive: css`
    background: ${cssVar.colorFillSecondary};
  `,
  optionDisabled: css`
    cursor: not-allowed;
    opacity: 0.55;

    &:hover {
      background: transparent;
    }
  `,
  optionIcon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 28px;
    height: 28px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};

    color: ${cssVar.colorText};

    background: ${cssVar.colorBgElevated};
  `,
  optionMeta: css`
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;

    min-width: 0;
  `,
  optionTitle: css`
    overflow: hidden;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tag: css`
    flex: none;

    padding-block: 0;
    padding-inline: 5px;
    border-radius: 4px;

    font-size: 10px;
    line-height: 16px;
    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillSecondary};
  `,
}));

export interface OptionRowProps {
  active?: boolean;
  desc?: ReactNode;
  disabled?: boolean;
  /** Trailing action, kept live while the row itself is disabled. */
  extra?: ReactNode;
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
  tag?: ReactNode;
}

const OptionRow = memo<OptionRowProps>(
  ({ active, desc, disabled, extra, icon, label, onClick, tag }) => (
    <div
      className={cx(
        styles.option,
        active && styles.optionActive,
        disabled && styles.optionDisabled,
      )}
      onClick={() => {
        if (!disabled) onClick();
      }}
    >
      <div className={styles.optionIcon}>{icon}</div>
      <div className={styles.optionMeta}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span className={styles.optionTitle}>{label}</span>
          {tag ? <span className={styles.tag}>{tag}</span> : null}
        </Flexbox>
        {desc ? <div className={styles.desc}>{desc}</div> : null}
      </div>
      {extra ? (
        <div
          className={styles.extra}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {extra}
        </div>
      ) : null}
      {active ? <Icon className={styles.check} icon={CheckIcon} size={14} /> : null}
    </div>
  ),
);

OptionRow.displayName = 'ControlBar.OptionRow';

export default OptionRow;
