import { Avatar, Block, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import type { ReactNode } from 'react';

import type { HeterogeneousAgentStatusGuideVariant } from './types';

interface GuideShellProps {
  actions?: ReactNode;
  children?: ReactNode;
  headerDescription?: ReactNode;
  icon: ReactNode;
  title: string;
  variant: HeterogeneousAgentStatusGuideVariant;
}

const GuideShell = ({
  actions,
  children,
  headerDescription,
  icon,
  title,
  variant,
}: GuideShellProps) => {
  const showHeader = variant !== 'embedded';
  const content = (
    <Flexbox gap={12}>
      {showHeader ? (
        <Flexbox horizontal align="center" gap={12}>
          <Avatar
            avatar={icon}
            background={cssVar.colorFillQuaternary}
            gap={12}
            shape={'square'}
            size={48}
          />
          <Flexbox gap={4}>
            <Text style={{ fontSize: 16, fontWeight: 600 }}>{title}</Text>
            {headerDescription}
          </Flexbox>
        </Flexbox>
      ) : (
        headerDescription
      )}

      {children}
      {actions}
    </Flexbox>
  );

  if (variant !== 'inline') return content;

  return (
    <Block
      gap={16}
      padding={16}
      variant={'outlined'}
      style={{
        background: cssVar.colorBgElevated,
        overflow: 'hidden',
        width: '100%',
      }}
    >
      {content}
    </Block>
  );
};

export default GuideShell;
