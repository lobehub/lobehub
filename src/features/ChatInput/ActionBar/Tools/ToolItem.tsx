import { Flexbox, Text } from '@lobehub/ui';
import { memo, Suspense } from 'react';

import DebugNode from '@/components/DebugNode';

import type { CheckboxItemProps } from '../components/CheckboxWithLoading';
import CheckboxItem from '../components/CheckboxWithLoading';

const ToolItem = memo<CheckboxItemProps>(({ id, onUpdate, label, checked }) => {
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
          </Flexbox>
        }
        onUpdate={onUpdate}
      />
    </Suspense>
  );
});

export default ToolItem;
