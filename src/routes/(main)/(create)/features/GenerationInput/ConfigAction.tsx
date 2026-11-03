'use client';

import { SlidersHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import Action from '@/features/ChatInput/ActionBar/components/Action';

interface ConfigActionProps {
  content: ReactNode;
  title: ReactNode;
}

const ConfigAction = memo<ConfigActionProps>(({ title, content }) => {
  return (
    <Action
      icon={SlidersHorizontal}
      popover={{ content, minWidth: 300, title }}
      title={typeof title === 'string' ? title : undefined}
      trigger={'click'}
    />
  );
});

ConfigAction.displayName = 'ConfigAction';

export default ConfigAction;
