'use client';

import { Block, Flexbox, Text } from '@lobehub/ui';

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

// Same outlined card as the statistics page's blocks, so the profile-group
// surfaces read as one family.
export const Section = ({ children, desc, title }: SectionProps) => (
  <Block gap={16} padding={20} variant="outlined">
    <Flexbox gap={2}>
      {/* Same title treatment as the statistics page's card headers. */}
      <Text fontSize={16} weight={500}>
        {title}
      </Text>
      {desc && (
        <Text fontSize={12} type="secondary">
          {desc}
        </Text>
      )}
    </Flexbox>
    {children}
  </Block>
);
