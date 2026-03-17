import { memo } from 'react';

import { useVideoGenerationConfigParam } from '@/store/video/slices/generationConfig/hooks';

import Select from './Select';

const SizeSelect = memo(() => {
  const { value, setValue, enumValues } = useVideoGenerationConfigParam('size');

  const options =
    enumValues?.map((size) => ({
      label: size,
      value: size,
    })) ?? [];

  return <Select options={options} value={value} onChange={setValue} />;
});

export default SizeSelect;
