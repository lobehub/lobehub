import { Select } from 'antd';
import { memo, useMemo } from 'react';

import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import { useUpdateAgentConfig } from '../../hooks/useUpdateAgentConfig';

const NANO_BANANA_ASPECT_RATIOS = [
  '1:1', // 1024x1024 / 2048x2048 / 4096x4096
  '2:3', // 848x1264 / 1696x2528 / 3392x5056
  '3:2', // 1264x848 / 2528x1696 / 5056x3392
  '3:4', // 896x1200 / 1792x2400 / 3584x4800
  '4:3', // 1200x896 / 2400x1792 / 4800x3584
  '4:5', // 928x1152 / 1856x2304 / 3712x4608
  '5:4', // 1152x928 / 2304x1856 / 4608x3712
  '9:16', // 768x1376 / 1536x2752 / 3072x5504
  '16:9', // 1376x768 / 2752x1536 / 5504x3072
  '21:9', // 1584x672 / 3168x1344 / 6336x2688
] as const;

type AspectRatio = (typeof NANO_BANANA_ASPECT_RATIOS)[number];

export interface ImageAspectRatioSelectProps {
  defaultValue?: AspectRatio;
  onChange?: (value: AspectRatio) => void;
  value?: AspectRatio;
}

// Inner pure UI component - no store hooks, safe for preview
const ImageAspectRatioSelectInner = memo<{
  onChange: (_value: AspectRatio) => void;
  value: AspectRatio;
}>(({ value, onChange }) => {
  const options = useMemo(
    () =>
      NANO_BANANA_ASPECT_RATIOS.map((ratio) => ({
        label: ratio,
        value: ratio,
      })),
    [],
  );

  return (
    <Select
      options={options}
      style={{ height: 32, marginRight: 10, width: 75 }}
      value={value}
      onChange={(v: string) => onChange(v as AspectRatio)}
    />
  );
});

// Store-connected component - uses agent store hooks
const ImageAspectRatioSelectWithStore = memo<{ defaultValue: AspectRatio }>(({ defaultValue }) => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const storeValue = (config.imageAspectRatio as AspectRatio) || defaultValue;

  const handleChange = (ratio: AspectRatio) => {
    updateAgentChatConfig({ imageAspectRatio: ratio });
  };

  return <ImageAspectRatioSelectInner value={storeValue} onChange={handleChange} />;
});

// Main exported component - chooses between controlled and store mode
const ImageAspectRatioSelect = memo<ImageAspectRatioSelectProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = '1:1' }) => {
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;

    if (isControlled) {
      // Controlled mode: use props only, no store access
      return (
        <ImageAspectRatioSelectInner
          value={controlledValue ?? defaultValue}
          onChange={controlledOnChange ?? (() => {})}
        />
      );
    }

    // Uncontrolled mode: use store
    return <ImageAspectRatioSelectWithStore defaultValue={defaultValue} />;
  },
);

export default ImageAspectRatioSelect;
