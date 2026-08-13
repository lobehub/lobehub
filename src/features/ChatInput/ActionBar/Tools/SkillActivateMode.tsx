import { Icon, Tooltip } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { SlidersHorizontal, Sparkles } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { agentProjectionSelectors, useAgentValue } from '@/store/agent/projection';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const SkillActivateMode = memo(() => {
  const { t } = useTranslation('setting');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const currentMode = useAgentValue(agentId, agentProjectionSelectors.skillActivateMode);

  return (
    <Tabs
      activeKey={currentMode}
      size="small"
      items={[
        {
          key: 'auto',
          label: (
            <Tooltip title={t('tools.skillActivateMode.auto.desc')}>
              <Icon icon={Sparkles} />
            </Tooltip>
          ),
        },
        {
          key: 'manual',
          label: (
            <Tooltip title={t('tools.skillActivateMode.manual.desc')}>
              <Icon icon={SlidersHorizontal} />
            </Tooltip>
          ),
        },
      ]}
      onChange={async (key) => {
        await updateAgentChatConfig({ skillActivateMode: key as 'auto' | 'manual' });
      }}
    />
  );
});

export default SkillActivateMode;
