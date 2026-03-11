import { Exa, Google } from '@lobehub/icons';
import { Flexbox, Icon } from '@lobehub/ui';
import { Switch } from 'antd';
import { Search } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

interface SearchEngineIconProps {
  icon?: string;
}

const SearchEngineIcon = ({ icon }: SearchEngineIconProps) => {
  switch (icon) {
    case 'google': {
      return <Google.Avatar size={20} />;
    }

    case 'exa': {
      return <Exa.Avatar size={20} />;
    }

    default: {
      return <Icon icon={Search} size={14} />;
    }
  }
};

const ModelBuiltinSearch = memo(() => {
  const { t } = useTranslation('chat');
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const [model, provider, checked] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    chatConfigByIdSelectors.getUseModelBuiltinSearchById(agentId)(s),
  ]);

  const [isLoading, setLoading] = useState(false);
  const modelCard = useAiInfraStore(aiModelSelectors.getEnabledModelById(model, provider));

  return (
    <Flexbox
      horizontal
      align={'center'}
      justify={'space-between'}
      padding={'8px 12px'}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      onClick={async () => {
        setLoading(true);
        await updateAgentChatConfig({ useModelBuiltinSearch: !checked });
        setLoading(false);
      }}
    >
      <Flexbox horizontal align={'center'} gap={8}>
        <SearchEngineIcon icon={modelCard?.settings?.searchProvider} />
        {t('search.mode.useModelBuiltin')}
      </Flexbox>
      <Switch checked={checked} loading={isLoading} size={'small'} />
    </Flexbox>
  );
});
export default ModelBuiltinSearch;
