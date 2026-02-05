import { memo } from 'react';

import Select from '@/features/ModelSelect';

import { useStore } from '../store';

const ModelSelect = memo(() => {
  const [model, provider, updateConfig] = useStore((s) => [
    s.config.model,
    s.config.provider,
    s.setAgentConfig,
  ]);

  return (
    <Select
      value={{ model, provider }}
      onChange={(props) => {
        updateConfig(props);
      }}
    />
  );
});

export default ModelSelect;
