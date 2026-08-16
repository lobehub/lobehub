import { PopoverGroup } from '@lobehub/ui';
import { Blocks } from 'lucide-react';
import { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { createSkillStoreModal } from '@/features/SkillStore';
import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { ChatInputAction } from '../components/ChatInputAction';
import PopoverContent from './PopoverContent';
import { useControls } from './useControls';

const Tools = memo(() => {
  const { t } = useTranslation('setting');
  const { marketItems, pinnedCount, autoCount } = useControls();

  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);

  const enableFC = useModelSupportToolUse(model, provider);

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  if (!enableFC)
    return (
      <ChatInputAction disabled icon={Blocks} showTooltip={true} title={t('tools.disabled')} />
    );

  // The action's own popover is controlled, so it stays standalone; only the
  // rows' detail cards and policy menus join the group and take turns in its
  // single shared popup.
  return (
    <Suspense fallback={<ChatInputAction disabled icon={Blocks} title={t('tools.title')} />}>
      <PopoverGroup>
        <ChatInputAction
          icon={Blocks}
          showTooltip={false}
          title={t('tools.title')}
          popover={{
            content: (
              <PopoverContent
                autoCount={autoCount}
                items={marketItems}
                pinnedCount={pinnedCount}
                onOpenStore={handleOpenStore}
              />
            ),
            maxWidth: 320,
            minWidth: 320,
            styles: {
              content: {
                padding: 0,
              },
            },
          }}
        />
      </PopoverGroup>
    </Suspense>
  );
});

export default Tools;
