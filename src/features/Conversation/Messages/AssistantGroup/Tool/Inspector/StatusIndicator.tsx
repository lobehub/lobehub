import { type ToolIntervention } from '@lobechat/types';
import { Block, Icon, Tooltip } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { AlertTriangle, Ban, Check, HandIcon, PauseIcon, X } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';
import { LOADING_FLAT } from '@/const/message';

interface StatusIndicatorProps {
  intervention?: ToolIntervention;
  /**
   * Whether the tool is currently executing (from operation state).
   * When false and result exists, treat as completed even if content is empty.
   */
  isToolExecuting?: boolean;
  result?: { content: string | null; error?: any; state?: any };
  /** Successful tool payload that should surface as warning (e.g. activateTools with only notFound). */
  successVariant?: 'default' | 'warning';
}

const StatusIndicator = memo<StatusIndicatorProps>(
  ({ intervention, isToolExecuting, result, successVariant }) => {
    const { t } = useTranslation('chat');

    const hasError = !!result?.error;
    const hasSuccessResult = !!result?.content && result.content !== LOADING_FLAT;
    const hasResult = hasSuccessResult || hasError;
    const isPending = intervention?.status === 'pending';
    const isReject = intervention?.status === 'rejected';
    const isAbort = intervention?.status === 'aborted';

    // Tool is complete if operation is not running and we have a result object (even if content is empty)
    const isToolComplete = isToolExecuting === false && !!result;

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
    } else if (hasSuccessResult && !hasError && successVariant === 'warning') {
      icon = <Icon color={cssVar.colorWarning} icon={AlertTriangle} />;
    } else if (hasResult || isToolComplete) {
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
  },
);

export default StatusIndicator;
