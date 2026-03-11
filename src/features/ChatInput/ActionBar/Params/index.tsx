import { SlidersHorizontal } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import Action from '../components/Action';
import Controls from './Controls';

const Params = memo(() => {
  const agentId = useAgentId();
  const [isLoading] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
  ]);
  const [updating, setUpdating] = useState(false);
  const { t } = useTranslation('setting');

  if (isLoading) return <Action disabled icon={SlidersHorizontal} />;

  return (
    <Action
      icon={SlidersHorizontal}
      loading={updating}
      showTooltip={false}
      title={t('settingModel.params.title')}
      popover={{
        content: <Controls setUpdating={setUpdating} updating={updating} />,
      }}
    />
  );
});

export default Params;
