import { Select } from 'antd';
import { memo, useCallback, useMemo } from 'react';

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
];

const ImageAspectRatioSelect = memo(() => {
  const agentId = useAgentId();
  const { updateAgentChatConfig } = useUpdateAgentConfig();
  const config = useAgentStore((s) => chatConfigByIdSelectors.getChatConfigById(agentId)(s));

  const imageAspectRatio = config.imageAspectRatio || '1:1';

  const options = useMemo(
    () =>
      NANO_BANANA_ASPECT_RATIOS.map((ratio) => ({
        label: ratio,
        value: ratio,
      })),
    [],
  );

  const updateAspectRatio = useCallback(
    (value: string) => {
      updateAgentChatConfig({ imageAspectRatio: value });
    },
    [updateAgentChatConfig],
  );

  return (
    <Select
      onChange={updateAspectRatio}
      options={options}
      style={{ height: 32, marginRight: 10, width: 75 }}
      value={imageAspectRatio}
    />
  );
});

export default ImageAspectRatioSelect;
