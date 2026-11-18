import { cssVar, Icon, Tooltip } from '@lobehub/ui';
import { LoaderCircleIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatInputStore } from '../store';

/**
 * A small spinner at the head of the send area while the agent runs, so it sits
 * beside the model selector that qualifies the run. Stop itself stays static.
 */
const RunningIndicator = memo(() => {
  const { t } = useTranslation('chat');
  const generating = useChatInputStore((s) => !!s.sendButtonProps?.generating);

  if (!generating) return null;

  return (
    <Tooltip title={t('input.running')}>
      <Icon
        spin
        aria-label={t('input.running')}
        color={cssVar.colorTextTertiary}
        data-testid="chat-input-running-indicator"
        icon={LoaderCircleIcon}
        role={'status'}
        size={14}
      />
    </Tooltip>
  );
});

RunningIndicator.displayName = 'RunningIndicator';

export default RunningIndicator;
