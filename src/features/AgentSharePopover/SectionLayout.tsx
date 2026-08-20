'use client';

import { Flexbox, Text } from '@lobehub/ui';

interface SettingRowProps {
  children: React.ReactNode;
  label: string;
}

export const SettingRow = ({ children, label }: SettingRowProps) => (
  <Flexbox horizontal align="center" gap={16} justify="space-between">
    <Text>{label}</Text>
    {children}
  </Flexbox>
);

interface SectionProps {
  children: React.ReactNode;
  desc?: string;
  title: string;
}

export const Section = ({ children, desc, title }: SectionProps) => (
  <Flexbox gap={12}>
    <Flexbox gap={2}>
      <Text strong>{title}</Text>
      {desc && (
        <Text fontSize={12} type="secondary">
          {desc}
        </Text>
      )}
    </Flexbox>
    {children}
  </Flexbox>
);
