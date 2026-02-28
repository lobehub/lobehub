'use client';

import { ActionIcon, Flexbox } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { ChevronRight } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo } from 'react';

import SidebarHeader from '@/components/SidebarHeader';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';

export const styles = createStaticStyles(({ css, cssVar }) => ({
  chevron: css`
    transition: transform 0.2s ${cssVar.motionEaseInOut};
  `,
  chevronExpanded: css`
    transform: rotate(90deg);
  `,
  container: css`
    position: relative;
    overflow: hidden auto;
    transition: all 0.2s ${cssVar.motionEaseInOut};
  `,
}));

export interface ConfigLayoutProps {
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  containerStyle?: CSSProperties;
  expandedHeight?: number | string;
  headerStyle?: CSSProperties;
  onHeaderClick?: () => void;
  sessionId: string;
  title: ReactNode;
}

const ConfigLayout = memo<ConfigLayoutProps>(
  ({
    title,
    actions,
    sessionId,
    className,
    headerStyle,
    containerStyle,
    expandedHeight,
    onHeaderClick,
    children,
  }) => {
    const [expanded, toggleAgentSystemRoleExpand] = useGlobalStore((s) => [
      systemStatusSelectors.getAgentSystemRoleExpanded(sessionId)(s),
      s.toggleAgentSystemRoleExpand,
    ]);

    const handleHeaderClick = () => {
      toggleAgentSystemRoleExpand(sessionId);
      onHeaderClick?.();
    };

    const computedStyle: CSSProperties = expanded
      ? {
          minHeight: 232,
          opacity: 1,
          ...(expandedHeight !== undefined ? { maxHeight: expandedHeight } : {}),
        }
      : {
          minHeight: 0,
          opacity: 0,
          ...(expandedHeight !== undefined ? { maxHeight: 0 } : {}),
        };

    const combinedActions = (
      <Flexbox horizontal align="center" gap={2}>
        {actions}
        <ActionIcon
          className={cx(styles.chevron, expanded && styles.chevronExpanded)}
          icon={ChevronRight}
          size="small"
          style={{
            pointerEvents: 'none',
          }}
          onClick={handleHeaderClick}
        />
      </Flexbox>
    );

    return (
      <Flexbox className={className} height={'fit-content'}>
        <SidebarHeader
          actions={combinedActions}
          title={title}
          style={{
            cursor: 'pointer',
            ...headerStyle,
          }}
          onClick={handleHeaderClick}
        />
        <Flexbox
          className={styles.container}
          style={{
            ...computedStyle,
            ...containerStyle,
          }}
        >
          {children}
        </Flexbox>
      </Flexbox>
    );
  },
);

ConfigLayout.displayName = 'ConfigLayout';

export default ConfigLayout;
