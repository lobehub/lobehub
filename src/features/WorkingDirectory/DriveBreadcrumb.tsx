'use client';

import { createStaticStyles, cssVar, Flexbox, Icon } from '@lobehub/ui';
import type { LucideIcon } from 'lucide-react';
import { ChevronRightIcon } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  crumb: css`
    cursor: pointer;

    overflow: hidden;

    max-width: 200px;
    padding: 0;
    border: none;

    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;

    background: none;

    &:hover {
      color: ${cssVar.colorText};
    }

    &:focus-visible {
      border-radius: ${cssVar.borderRadiusSM};
      outline: 2px solid ${cssVar.colorPrimaryBorder};
    }
  `,
  current: css`
    overflow: hidden;

    max-width: 240px;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

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
          <Icon icon={icon} size={14} style={{ color: cssVar.colorTextTertiary }} />
        )}
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          const iconRoot = index === 0 && rootIconOnly && icon;

          if (iconRoot) {
            return (
              <button
                aria-label={crumb.label}
                className={styles.crumb}
                disabled={last}
                key={'root'}
                style={{ display: 'inline-flex' }}
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
                  icon={ChevronRightIcon}
                  size={12}
                  style={{ color: cssVar.colorTextQuaternary }}
                />
              )}
              {last ? (
                <span aria-current={'page'} className={styles.current} title={crumb.label}>
                  {crumb.label}
                </span>
              ) : (
                <button
                  className={styles.crumb}
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
