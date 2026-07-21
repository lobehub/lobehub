import { ModelIcon } from '@lobehub/icons';
import { Center, Tooltip } from '@lobehub/ui';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import { usePermission } from '@/hooks/usePermission';

import { useAgentId } from '../../hooks/useAgentId';
import { useAgentModelSelection } from '../../hooks/useAgentModelSelection';
import { useChatInputResourceAccess } from '../../hooks/useChatInputResourceAccess';
import { useActionBarContext } from '../context';

const styles = createStaticStyles(({ css, cssVar }) => ({
  icon: css`
    transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
  `,
  modelDisabled: css`
    cursor: not-allowed;
    opacity: 0.5;

    :hover {
      background: transparent;
    }

    :active {
      div {
        scale: 1;
      }
    }
  `,
  model: css`
    cursor: pointer;
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillSecondary};
    }

    :active {
      div {
        scale: 0.8;
      }
    }
  `,
}));

const ModelSwitch = memo(() => {
  const { t } = useTranslation('setting');
  const { actionSize, dropdownPlacement } = useActionBarContext();
  const blockSize = actionSize?.blockSize ?? 32;
  const iconSize = actionSize?.size ?? 20;
  const { allowed: canCreateContent, reason } = usePermission('create_content');
  const { canConfigureResource, canUseResource, isAccessLoading } = useChatInputResourceAccess();
  const agentId = useAgentId();
  const { isPreferenceLoading, isWorkspaceAgent, model, provider, selectionPolicy, selectModel } =
    useAgentModelSelection(agentId);
  const canSelectForAgent = isWorkspaceAgent
    ? canUseResource && selectionPolicy === 'member'
    : canConfigureResource;
  const canSelectModel =
    canCreateContent && canSelectForAgent && !isAccessLoading && !isPreferenceLoading;
  const disabledReason = !canCreateContent
    ? reason
    : isAccessLoading || isPreferenceLoading
      ? t('checkingPermissions')
      : isWorkspaceAgent && !canUseResource
        ? t('permission.accessTag.viewOnlyTip')
        : isWorkspaceAgent && selectionPolicy === 'fixed'
          ? t('settingAgent.modelPolicy.fixedTip')
          : t('permission.accessTag.useOnlyTip');

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      if (!canSelectModel) return;

      await selectModel(params);
    },
    [canSelectModel, selectModel],
  );

  const trigger = (
    <Center
      aria-disabled={!canSelectModel}
      aria-label={model}
      className={cx(styles.model, !canSelectModel && styles.modelDisabled)}
      height={blockSize}
      width={blockSize}
    >
      <div className={styles.icon}>
        <ModelIcon model={model} size={iconSize} />
      </div>
    </Center>
  );

  if (!canSelectModel)
    return (
      <Tooltip title={`${model} · ${disabledReason}`}>
        <div>{trigger}</div>
      </Tooltip>
    );

  return (
    <ModelSwitchPanel
      model={model}
      placement={dropdownPlacement}
      provider={provider}
      onModelChange={handleModelChange}
    >
      {trigger}
    </ModelSwitchPanel>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;
