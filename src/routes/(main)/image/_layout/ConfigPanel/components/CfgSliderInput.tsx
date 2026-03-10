import { SliderWithInput } from '@lobehub/ui';
import { memo } from 'react';

import { useGenerationConfigParam } from '@/store/image/slices/generationConfig/hooks';

const CfgSliderInput = memo(() => {
  const { value, setValue, min, max } = useGenerationConfigParam('cfg');
  return <SliderWithInput max={max} min={min} value={value} onChange={setValue} />;
});

export default CfgSliderInput;
