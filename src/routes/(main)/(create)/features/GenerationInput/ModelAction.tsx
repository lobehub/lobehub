'use client';

import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import { memo } from 'react';

import Action from '@/features/ChatInput/ActionBar/components/Action';

interface ModelActionProps {
  content: ReactNode;
  title: ReactNode;
}

const ModelAction = memo<ModelActionProps>(({ title, content }) => {
  return (
    <Action
      icon={Bot}
      popover={{ content, minWidth: 300, title }}
      title={typeof title === 'string' ? title : undefined}
      trigger={'click'}
    />
  );
});

ModelAction.displayName = 'ModelAction';

export default ModelAction;
