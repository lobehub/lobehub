'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

/**
 * One choice in a composer menu: framed icon, title over a description, and a
 * check when it is the current one.
 *
 * Shared rather than copied because these menus sit next to each other in the
 * same bar and are read as one control surface — a second copy of the styles
 * would drift into looking like a different kind of thing.
 */
const styles = stylex.create({
  check: { flex: 'none', marginInlineStart: 'auto', color: cssVar.colorPrimary },
  desc: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
    fontSize: '11px',
    color: cssVar.colorTextDescription,
  },
  extra: {
    display: 'flex',
    flex: 'none',
    gap: '4px',
    alignItems: 'center',
    marginInlineStart: 'auto',
  },
  option: {
    cursor: 'pointer',
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    paddingBlock: '8px',
    paddingInline: '8px',
    borderRadius: cssVar.borderRadius,
    transition: 'background-color 0.2s',
    backgroundColor: { 'default': null, ':hover': cssVar.colorFillTertiary },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  optionActive: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': cssVar.colorFillTertiary },
    backgroundImage: 'none',
  },
  optionActiveDisabled: {
    backgroundColor: { 'default': cssVar.colorFillSecondary, ':hover': 'transparent' },
    backgroundImage: 'none',
  },
  optionDisabled: {
    cursor: 'not-allowed',
    backgroundColor: { 'default': null, ':hover': 'transparent' },
    backgroundImage: { 'default': null, ':hover': 'none' },
  },
  optionCompact: { gap: '8px', paddingBlock: '6px' },
  /* Dims the row's own content rather than the row. Its trailing action is the
     way OUT of that state — dimming it would read as "also unavailable" — and
     opacity on the row cannot be undone by a child, so the action is left out
     of the dimmed elements instead. */
  dimmed: { opacity: 0.55 },
  optionIcon: {
    display: 'flex',
    flex: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    color: cssVar.colorText,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  optionIconCompact: {
    width: '16px',
    height: '16px',
    borderStyle: 'none',
    backgroundColor: 'transparent',
  },
  optionMeta: {
    display: 'flex',
    flex: '1',
    flexDirection: 'column',
    gap: '1px',
    minWidth: '0',
  },
  optionTitle: {
    overflow: 'hidden',
    fontSize: '13px',
    fontWeight: 500,
    color: cssVar.colorText,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  hint: {
    overflow: 'hidden',
    minWidth: '0',
    fontSize: '11px',
    color: cssVar.colorTextDescription,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  tag: {
    flex: 'none',
    paddingBlock: '0',
    paddingInline: '5px',
    borderRadius: '4px',
    fontSize: '10px',
    lineHeight: '16px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillSecondary,
    backgroundImage: 'none',
  },
});

export interface OptionRowProps {
  active?: boolean;
  /** The row opens a second level, so it ends in an arrow instead of a check. */
  arrow?: boolean;
  /** A ready-made mark beside the title, shown as it is rather than in a neutral pill. */
  badge?: ReactNode;
  /** A dense row for long lists: no icon frame, so its icon lines up with the menu's text. */
  compact?: boolean;
  desc?: ReactNode;
  disabled?: boolean;
  /** Trailing action, kept live while the row itself is disabled. */
  extra?: ReactNode;
  /** A short muted note beside the title, such as the owner/name of a repository. */
  hint?: ReactNode;
  icon: ReactNode;
  label: ReactNode;
  onClick: () => void;
  /** One trailing tag. Use {@link OptionRowProps.tags} for several. */
  tag?: ReactNode;
  /** Several tags, each in its own pill rather than one pill holding them all. */
  tags?: ReactNode[];
  /** Restyles the row; applied last so it wins over the defaults. */
  xstyle?: stylex.StyleXStyles;
}

const OptionRow = memo<OptionRowProps>(
  ({
    active,
    arrow,
    badge,
    compact,
    desc,
    disabled,
    extra,
    hint,
    icon,
    label,
    onClick,
    tag,
    tags,
    xstyle,
  }) => (
    <div
      onClick={() => {
        if (!disabled) onClick();
      }}
      {...stylex.props(
        styles.option,
        compact && styles.optionCompact,
        active && styles.optionActive,
        disabled && styles.optionDisabled,
        active && disabled && styles.optionActiveDisabled,
        xstyle,
      )}
    >
      <div
        {...stylex.props(
          styles.optionIcon,
          compact && styles.optionIconCompact,
          disabled && styles.dimmed,
        )}
      >
        {icon}
      </div>
      <div {...stylex.props(styles.optionMeta, disabled && styles.dimmed)}>
        <Flexbox horizontal align={'center'} gap={6}>
          <span {...stylex.props(styles.optionTitle)}>{label}</span>
          {hint ? <span {...stylex.props(styles.hint)}>{hint}</span> : null}
          {badge}
          {tag ? <span {...stylex.props(styles.tag)}>{tag}</span> : null}
          {tags?.map((item, index) => (
            <span key={index} {...stylex.props(styles.tag)}>
              {item}
            </span>
          ))}
        </Flexbox>
        {desc ? <div {...stylex.props(styles.desc)}>{desc}</div> : null}
      </div>
      {extra ? (
        <div
          data-option-extra
          {...stylex.props(styles.extra)}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          {extra}
        </div>
      ) : null}
      {arrow ? <Icon icon={ChevronRightIcon} size={14} /> : null}
      {active && !arrow ? (
        <Icon
          className={stylex.props(styles.check, disabled && styles.dimmed).className}
          icon={CheckIcon}
          size={14}
        />
      ) : null}
    </div>
  ),
);

OptionRow.displayName = 'ControlBar.OptionRow';

export default OptionRow;
