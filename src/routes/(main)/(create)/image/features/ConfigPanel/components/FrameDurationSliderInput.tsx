import { SliderWithInput } from '@lobehub/ui';
import { memo } from 'react';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const FrameDurationSliderInput = memo(() => {
  const { value, setValue, min, max, step } = useGenerationConfigParam('frameDurationMs');
  return <SliderWithInput max={max} min={min} step={step} value={value} onChange={setValue} />;
});

export default FrameDurationSliderInput;
