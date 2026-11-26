import { Blocks } from 'lucide-react';
import { memo, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { useModelSupportToolUse } from '@/hooks/useModelSupportToolUse';

import { useAgentId } from '../../hooks/useAgentId';
import { useEffectiveModel } from '../../hooks/useEffectiveModel';
import { ChatInputAction } from '../components/ChatInputAction';
import PopoverContent from './PopoverContent';
import { useControls } from './useControls';

const Tools = memo(() => {
  const { t } = useTranslation('setting');
  const { marketItems, marketHeader, autoCount, isPolicyMenuOpen } = useControls();

  const agentId = useAgentId();
  const { model, provider } = useEffectiveModel(agentId);

  const enableFC = useModelSupportToolUse(model, provider);

  if (!enableFC)
    return (
      <ChatInputAction
        disabled
        icon={Blocks}
        showTooltip={true}
        title={t('tools.picker.disabled')}
      />
    );

  return (
    <Suspense fallback={<ChatInputAction disabled icon={Blocks} title={t('tools.picker.title')} />}>
      <ChatInputAction
        icon={Blocks}
        showTooltip={false}
        title={t('tools.picker.title')}
        popover={{
          content: (
            <PopoverContent
              autoCount={autoCount}
              detailPopoverDisabled={isPolicyMenuOpen}
              header={marketHeader}
              items={marketItems}
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
    </Suspense>
  );
});

export default Tools;
