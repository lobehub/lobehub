import { SliderWithInput } from '@lobehub/ui';
import { memo } from 'react';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const FrameCountSliderInput = memo(() => {
  const { value, setValue, min, max, step } = useGenerationConfigParam('frameCount');
  return <SliderWithInput max={max} min={min} step={step} value={value} onChange={setValue} />;
});

export default FrameCountSliderInput;
