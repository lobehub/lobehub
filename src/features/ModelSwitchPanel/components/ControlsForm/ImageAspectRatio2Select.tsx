import { Select } from 'antd';
import { memo, useMemo } from 'react';

import { useAgentId } from '@/features/ChatInput/hooks/useAgentId';
import { useUpdateAgentConfig } from '@/features/ChatInput/hooks/useUpdateAgentConfig';
import { useAgentStore } from '@/store/agent';
import { chatConfigByIdSelectors } from '@/store/agent/selectors';

const NANO_BANANA_2_ASPECT_RATIOS = [
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
  '1:4', // ultra-tall portrait
  '4:1', // ultra-wide landscape
  '1:8', // extreme portrait
  '8:1', // extreme landscape
] as const;

type AspectRatio2 = (typeof NANO_BANANA_2_ASPECT_RATIOS)[number];

export interface ImageAspectRatio2SelectProps {
  defaultValue?: AspectRatio2;
  onChange?: (value: AspectRatio2) => void;
  value?: AspectRatio2;
}

// Inner pure UI component - no store hooks, safe for preview
const ImageAspectRatio2SelectInner = memo<{
  onChange: (_value: AspectRatio2) => void;
  value: AspectRatio2;
}>(({ value, onChange }) => {
  const options = useMemo(
    () =>
      NANO_BANANA_2_ASPECT_RATIOS.map((ratio) => ({
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
      onChange={(v: string) => onChange(v as AspectRatio2)}
    />
  );
});

// Store-connected component - uses agent store hooks
const ImageAspectRatio2SelectWithStore = memo<{ defaultValue: AspectRatio2 }>(
  ({ defaultValue }) => {
    const agentId = useAgentId();
    const { updateAgentChatConfig } = useUpdateAgentConfig();
    const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

    const storeValue = (config.imageAspectRatio2 as AspectRatio2) || defaultValue;

    const handleChange = (ratio: AspectRatio2) => {
      updateAgentChatConfig({ imageAspectRatio2: ratio });
    };

    return <ImageAspectRatio2SelectInner value={storeValue} onChange={handleChange} />;
  },
);

// Main exported component - chooses between controlled and store mode
const ImageAspectRatio2Select = memo<ImageAspectRatio2SelectProps>(
  ({ value: controlledValue, onChange: controlledOnChange, defaultValue = '1:1' }) => {
    const isControlled = controlledValue !== undefined || controlledOnChange !== undefined;

    if (isControlled) {
      // Controlled mode: use props only, no store access
      return (
        <ImageAspectRatio2SelectInner
          value={controlledValue ?? defaultValue}
          onChange={controlledOnChange ?? (() => {})}
        />
      );
    }

    // Uncontrolled mode: use store
    return <ImageAspectRatio2SelectWithStore defaultValue={defaultValue} />;
  },
);

export default ImageAspectRatio2Select;
