import { type ToolIntervention } from '@lobechat/types';
import { Block, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { Ban, Check, HandIcon, PauseIcon, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { LOADING_FLAT } from '@/const/message';

interface StatusIndicatorProps {
  intervention?: ToolIntervention;
  result?: { content: string | null; error?: any; state?: any };
}

const StatusIndicator = memo<StatusIndicatorProps>(({ intervention, result }) => {
  const { t } = useTranslation('chat');

  const hasError = !!result?.error;
  const hasSuccessResult = !!result?.content && result.content !== LOADING_FLAT;
  const hasResult = hasSuccessResult || hasError;
  const isPending = intervention?.status === 'pending';
  const isReject = intervention?.status === 'rejected';
  const isAbort = intervention?.status === 'aborted';

  let icon;

  if (isAbort) {
    icon = (
      <Tooltip title={t('tool.intervention.toolAbort')}>
        <Icon color={cssVar.colorTextTertiary} icon={PauseIcon} />
      </Tooltip>
    );
  } else if (isReject) {
    icon = (
      <Tooltip title={t('tool.intervention.toolRejected')}>
        <Icon color={cssVar.colorTextTertiary} icon={Ban} />
      </Tooltip>
    );
  } else if (hasError) {
    icon = <Icon color={cssVar.colorError} icon={X} />;
  } else if (isPending) {
    icon = <Icon color={cssVar.colorInfo} icon={HandIcon} />;
  } else if (hasResult) {
    icon = <Icon color={cssVar.colorSuccess} icon={Check} />;
  } else {
    icon = <NeuralNetworkLoading size={16} />;
  }

  return (
    <Block
      horizontal
      align={'center'}
      flex={'none'}
      gap={4}
      height={24}
      justify={'center'}
      variant={'outlined'}
      width={24}
      style={{
        fontSize: 12,
      }}
    >
      {icon}
    </Block>
  );
});

export default StatusIndicator;
