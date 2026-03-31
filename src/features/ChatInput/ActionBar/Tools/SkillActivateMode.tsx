import { Icon, Segmented, Tooltip } from '@lobehub/ui';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const SkillActivateMode = memo(() => {
  const { t } = useTranslation('setting');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const currentMode = useAgentStore((s) =>
    chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s),
  );

  return (
    <Segmented
      size="small"
      value={currentMode}
      options={[
        {
          label: (
            <Tooltip title={t('tools.skillActivateMode.auto.desc')}>
              <Icon icon={Sparkles} />
            </Tooltip>
          ),
          value: 'auto',
        },
        {
          label: (
            <Tooltip title={t('tools.skillActivateMode.manual.desc')}>
              <Icon icon={SlidersHorizontal} />
            </Tooltip>
          ),
          value: 'manual',
        },
      ]}
      onChange={async (value) => {
        await updateAgentChatConfig({ skillActivateMode: value as 'auto' | 'manual' });
      }}
    />
  );
});

export default SkillActivateMode;
