import { OpenAIProviderCard } from 'model-bank/modelProviders';

import { useSettingsContext } from '@/features/Settings/Layout/ContextProvider';

import ProviderDetail from '../default';

const Page = () => {
  const { showOpenAIProxyUrl, showOpenAIApiKey } = useSettingsContext();

  return (
    <ProviderDetail
      {...OpenAIProviderCard}
      settings={{
        ...OpenAIProviderCard.settings,
        proxyUrl: showOpenAIProxyUrl && {
          placeholder: 'https://api.openai.com/v1',
        },
        showApiKey: showOpenAIApiKey,
      }}
    />
  );
};

export default Page;
