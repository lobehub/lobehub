'use client';

import { Flexbox, Icon } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

const styles = createStaticStyles(({ css }) => ({
  card: css`
    align-self: flex-start;

    width: calc(50% - 4px);
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};

    @container (max-width: 840px) {
      width: 100%;
    }
  `,
  fullWidth: css`
    width: 100%;
  `,
  title: css`
    font-size: 14px;
    font-weight: 500;
  `,
}));

interface WorkspaceAgentPolicyCardProps {
  action?: ReactNode;
  children?: ReactNode;
  fullWidth?: boolean;
  icon: LucideIcon;
  title: ReactNode;
}

export const WorkspaceAgentPolicyCard = memo<WorkspaceAgentPolicyCardProps>(
  ({ action, children, fullWidth, icon, title }) => (
    <Flexbox className={cx(styles.card, fullWidth && styles.fullWidth)} gap={12}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon icon={icon} size={16} />
          <Text className={styles.title}>{title}</Text>
        </Flexbox>
        {action}
      </Flexbox>
      {children}
    </Flexbox>
  ),
);

WorkspaceAgentPolicyCard.displayName = 'WorkspaceAgentPolicyCard';
