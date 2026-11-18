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
    padding: 16,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorBgContainer,
  },
  fullWidth: {
    width: '100%',
  },
  title: {
    fontSize: 14,
    fontWeight: 500,
  },
});

interface AgentConfigCardProps {
  action?: ReactNode;
  children?: ReactNode;
  fullWidth?: boolean;
  icon: LucideIcon;
  title: ReactNode;
}

/** One configuration card on the Agent Profile (model, environment, tools…). */
export const AgentConfigCard = memo<AgentConfigCardProps>(
  ({ action, children, fullWidth, icon, title }) => (
    <Flexbox gap={12} {...stylex.props(styles.card, fullWidth && styles.fullWidth)}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon icon={icon} size={16} />
          <Text {...stylex.props(styles.title)}>{title}</Text>
        </Flexbox>
        {action}
      </Flexbox>
      {children}
    </Flexbox>
  ),
);

AgentConfigCard.displayName = 'AgentConfigCard';
