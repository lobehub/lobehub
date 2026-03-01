'use client';

import { Flexbox, Text } from '@lobehub/ui';
import { type CSSProperties, type ReactNode } from 'react';

interface ProfileRowProps {
  action?: ReactNode;
  children: ReactNode;
  label: string;
  mobile?: boolean;
}

export const rowStyle: CSSProperties = {
  minHeight: 48,
  padding: '16px 0',
};

export const labelStyle: CSSProperties = {
  flexShrink: 0,
  width: 160,
};

const ProfileRow = ({ label, children, action, mobile }: ProfileRowProps) => {
  if (mobile) {
    return (
      <Flexbox gap={12} style={rowStyle}>
        <Flexbox horizontal align="center" justify="space-between">
          <Text strong>{label}</Text>
          {action}
        </Flexbox>
        <Flexbox>{children}</Flexbox>
      </Flexbox>
    );
  }

  return (
    <Flexbox horizontal align="center" gap={24} justify="space-between" style={rowStyle}>
      <Flexbox horizontal align="center" gap={24} style={{ flex: 1 }}>
        <Text style={labelStyle}>{label}</Text>
        <Flexbox style={{ flex: 1 }}>{children}</Flexbox>
      </Flexbox>
      {action && <Flexbox>{action}</Flexbox>}
    </Flexbox>
  );
};

export default ProfileRow;
