'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

const styles = stylex.create({
  card: {
    alignSelf: 'flex-start',
    width: { 'default': 'calc(50% - 4px)', '@container (max-width: 840px)': '100%' },
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  fullWidth: { width: '100%' },
  title: { fontSize: '14px', fontWeight: 500 },
});

interface WorkspaceAgentPolicyCardProps {
  action?: ReactNode;
  children?: ReactNode;
  fullWidth?: boolean;
  icon: LucideIcon;
  title: ReactNode;
}

export const WorkspaceAgentPolicyCard = memo<WorkspaceAgentPolicyCardProps>(
  ({ action, children, fullWidth, icon, title }) => (
    <Flexbox
      className={stylex.props(styles.card, fullWidth && styles.fullWidth).className}
      gap={12}
    >
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon icon={icon} size={16} />
          <Text className={stylex.props(styles.title).className}>{title}</Text>
        </Flexbox>
        {action}
      </Flexbox>
      {children}
    </Flexbox>
  ),
);

WorkspaceAgentPolicyCard.displayName = 'WorkspaceAgentPolicyCard';
