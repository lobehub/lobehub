'use client';

import { Block, Flexbox } from '@lobehub/ui';
import { Text } from '@lobehub/ui/base-ui';

interface SettingRowProps {
  children: React.ReactNode;
  /** Secondary line under the label, e.g. a "coming soon" note for a disabled control. */
  desc?: string;
  label: string;
}

export const SettingRow = ({ children, desc, label }: SettingRowProps) => (
  <Flexbox horizontal align="center" gap={16} justify="space-between">
    <Flexbox gap={2}>
      <Text>{label}</Text>
      {desc && (
        <Text fontSize={12} type="secondary">
          {desc}
        </Text>
      )}
    </Flexbox>
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
