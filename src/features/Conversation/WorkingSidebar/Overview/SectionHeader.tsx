import { Icon } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon } from 'lucide-react';
import { memo, type ReactNode } from 'react';

import { sectionHeaderMarker } from './markers.stylex';
import { sectionStyles } from './sectionStyles';

interface SectionHeaderProps {
  actions?: ReactNode;
  collapsed?: boolean;
  controls?: string;
  count?: ReactNode;
  meta?: ReactNode;
  onToggle?: () => void;
  title: ReactNode;
  titleAttr?: string;
}

export const SectionHeader = memo<SectionHeaderProps>(
  ({ actions, collapsed = false, controls, count, meta, onToggle, title, titleAttr }) => {
    const label = (
      <>
        <span {...stylex.props(sectionStyles.sectionTitle)} title={titleAttr}>
          {title}
        </span>
        {meta}
        {count !== undefined && count !== null && (
          <span {...stylex.props(sectionStyles.count)}>{count}</span>
        )}
      </>
    );

    return (
      <div {...stylex.props(sectionStyles.sectionHeader, sectionHeaderMarker)}>
        {onToggle ? (
          <button
            aria-controls={controls}
            aria-expanded={!collapsed}
            type={'button'}
            {...stylex.props(sectionStyles.toggle)}
            onClick={onToggle}
          >
            {label}
            <span
              {...stylex.props(sectionStyles.chevron, collapsed && sectionStyles.chevronCollapsed)}
            >
              <Icon icon={ChevronDownIcon} size={12} />
            </span>
          </button>
        ) : (
          label
        )}
        {actions && <span {...stylex.props(sectionStyles.actions)}>{actions}</span>}
      </div>
    );
  },
);

SectionHeader.displayName = 'OverviewSectionHeader';
