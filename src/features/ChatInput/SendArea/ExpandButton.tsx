import { ActionIcon } from '@lobehub/ui';
import { Maximize2Icon, Minimize2Icon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '@/features/ChatInput/store';
import { usePermission } from '@/hooks/usePermission';

const ExpandButton = memo(() => {
  const { t } = useTranslation('editor');
  const [expand, setExpand, editor] = useChatInputStore((s) => [s.expand, s.setExpand, s.editor]);
  const { allowed: canUseChatInputAction, reason } = usePermission('create_content');
  return (
    <ActionIcon
      className="show-on-hover"
      disabled={!canUseChatInputAction}
      icon={expand ? Minimize2Icon : Maximize2Icon}
      size={{ blockSize: 32, size: 16, strokeWidth: 2.3 }}
      style={{
        zIndex: 10,
      }}
      title={
        canUseChatInputAction ? t(expand ? 'actions.expand.off' : 'actions.expand.on') : reason
      }
      onClick={() => {
        if (!canUseChatInputAction) return;
        setExpand?.(!expand);
        editor?.focus();
      }}
    />
  );
});

ExpandButton.displayName = 'ExpandButton';

export default ExpandButton;
