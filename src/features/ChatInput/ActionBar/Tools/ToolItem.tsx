import { Flexbox, Text } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import DebugNode from '@/components/DebugNode';
import PluginTag from '@/components/Plugins/PluginTag';
import { useToolStore } from '@/store/tool';
import { customPluginSelectors } from '@/store/tool/selectors';

import type { CheckboxItemProps } from '../components/CheckboxWithLoading';
import CheckboxItem from '../components/CheckboxWithLoading';

const ToolItem = memo<CheckboxItemProps>(({ id, onUpdate, label, checked }) => {
  const isCustom = useToolStore((s) => customPluginSelectors.isCustomPlugin(id)(s));

  return (
    <Suspense fallback={<DebugNode trace="ActionBar/Tools/ToolItem" />}>
      <CheckboxItem
        checked={checked}
        hasPadding={false}
        id={id}
        label={
          <Flexbox allowShrink horizontal align={'center'} gap={8}>
            <Text
              style={{ lineHeight: 1.4, paddingBlock: 1 }}
              ellipsis={{
                tooltipWhenOverflow: true,
              }}
            >
              {label || id}
            </Text>
            {isCustom && <PluginTag showText={false} type={'customPlugin'} />}
          </Flexbox>
        }
        onUpdate={onUpdate}
      />
    </Suspense>
  );
});

export default ToolItem;
