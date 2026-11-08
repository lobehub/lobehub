import { Block, Flexbox, Text } from '@lobehub/ui';
import type { ReactNode } from 'react';

interface SectionProps {
  action?: ReactNode;
  children: ReactNode;
  description?: string;
  title: string;
}

export function Section({ action, children, description, title }: SectionProps) {
  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align="flex-start" gap={16} justify="space-between">
        <Flexbox gap={4}>
          <Text fontSize={16} weight={600}>
            {title}
          </Text>
          {description && <Text type="secondary">{description}</Text>}
        </Flexbox>
        {action}
      </Flexbox>
      <Block padding={16} variant="outlined">
        {children}
      </Block>
    </Flexbox>
  );
}
