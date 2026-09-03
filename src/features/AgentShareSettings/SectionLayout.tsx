'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';
import type { ReactNode } from 'react';

interface SettingRowProps {
  children: ReactNode;
  /** Secondary line under the label. */
  desc?: ReactNode;
  label: string;
}

export const SettingRow = ({ children, desc, label }: SettingRowProps) => (
  <Flexbox horizontal align={'center'} gap={16} justify={'space-between'}>
    <Flexbox gap={2}>
      <Text>{label}</Text>
      {desc && (
        <Text fontSize={12} type={'secondary'}>
          {desc}
        </Text>
      )}
    </Flexbox>
    {children}
  </Flexbox>
);

interface SectionProps {
  children: ReactNode;
  desc?: ReactNode;
  extra?: ReactNode;
  title: string;
}

export const Section = ({ children, desc, extra, title }: SectionProps) => (
  <Block gap={16} padding={20} variant={'outlined'}>
    <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
      <Flexbox gap={2}>
        <Text fontSize={16} weight={500}>
          {title}
        </Text>
        {desc && (
          <Text fontSize={12} type={'secondary'}>
            {desc}
          </Text>
        )}
      </Flexbox>
      {extra}
    </Flexbox>
    {children}
  </Block>
);
