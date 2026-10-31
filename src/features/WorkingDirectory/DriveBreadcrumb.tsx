'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';

const styles = stylex.create({
  crumb: {
    backgroundColor: 'transparent',
    borderRadius: { 'default': null, ':focus-visible': cssVar.borderRadiusSM },
    borderStyle: 'none',
    color: { 'default': cssVar.colorTextSecondary, ':hover': cssVar.colorText },
    cursor: 'pointer',
    fontSize: 13,
    maxWidth: 200,
    outline: { 'default': null, ':focus-visible': `2px solid ${cssVar.colorPrimaryBorder}` },
    overflow: 'hidden',
    padding: 0,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  current: {
    color: cssVar.colorText,
    fontSize: 13,
    fontWeight: 500,
    maxWidth: 240,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  iconCrumb: {
    display: 'inline-flex',
  },
  muted: {
    color: cssVar.colorTextTertiary,
  },
  separator: {
    color: cssVar.colorTextQuaternary,
  },
});

interface DriveBreadcrumbProps {
  /** Beside the root's name — the drive's own mark. */
  icon?: LucideIcon;
  onNavigate: (path: string) => void;
  /** Relative to the drive's root; `''` is the root. */
  path: string;
  /**
   * Show the root as its icon alone — where something beside the breadcrumb
   * already names the drive, such as the picker's drive switch.
   */
  rootIconOnly?: boolean;
  rootLabel: string;
}

/**
 * Where a drive listing is, read as a path: the drive's name, then each
 * folder on the way down. Every step but the last goes back up to it, so the
 * same row is both the address and the way back — no separate "up" or
 * "home" buttons, and no read-only address field to stare at.
 */
export const DriveBreadcrumb = memo<DriveBreadcrumbProps>(
  ({ icon, onNavigate, path, rootIconOnly, rootLabel }) => {
    const segments = path ? path.split('/') : [];
    // At the root an icon-only crumb would be a lone glyph pointing nowhere;
    // the trail appears once there is somewhere to go back to.
    if (rootIconOnly && segments.length === 0) return <span />;
    const crumbs = [
      { label: rootLabel, path: '' },
      ...segments.map((segment, index) => ({
        label: segment,
        path: segments.slice(0, index + 1).join('/'),
      })),
    ];

    return (
      <Flexbox
        horizontal
        align={'center'}
        aria-label={rootLabel}
        as={'nav'}
        gap={4}
        style={{ minWidth: 0 }}
        wrap={'wrap'}
      >
        {icon && !rootIconOnly && (
          <Icon className={stylex.props(styles.muted).className} icon={icon} size={14} />
        )}
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const iconRoot = index === 0 && rootIconOnly && icon;

          if (iconRoot) {
            return (
              <button
                aria-label={crumb.label}
                {...stylex.props(styles.crumb, styles.iconCrumb)}
                disabled={last}
                key={'root'}
                title={crumb.label}
                type={'button'}
                onClick={() => onNavigate('')}
              >
                <Icon icon={icon} size={14} />
              </button>
            );
          }

          return (
            <Flexbox horizontal align={'center'} gap={4} key={crumb.path || 'root'}>
              {index > 0 && (
                <Icon
                  className={stylex.props(styles.separator).className}
                  icon={ChevronRightIcon}
                  size={12}
                />
              )}
              {last ? (
                <span aria-current={'page'} {...stylex.props(styles.current)} title={crumb.label}>
                  {crumb.label}
                </span>
              ) : (
                <button
                  {...stylex.props(styles.crumb)}
                  title={crumb.label}
                  type={'button'}
                  onClick={() => onNavigate(crumb.path)}
                >
                  {crumb.label}
                </button>
              )}
            </Flexbox>
          );
        })}
      </Flexbox>
    );
  },
);

DriveBreadcrumb.displayName = 'DriveBreadcrumb';
