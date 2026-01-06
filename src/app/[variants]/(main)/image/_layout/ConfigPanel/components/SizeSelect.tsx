import { memo } from 'react';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

import Select from './Select';

const SizeSelect = memo(() => {
  const { value, setValue, enumValues } = useGenerationConfigParam('size');
  const options = enumValues!.map((size) => ({
    label: size,
    value: size,
  }));

  return <Select onChange={setValue} options={options} value={value} />;
});

export default SizeSelect;
