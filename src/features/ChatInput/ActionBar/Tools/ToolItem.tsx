import { Flexbox } from '@lobehub/ui';
import { Suspense, memo } from 'react';

import DebugNode from '@/components/DebugNode';
import PluginTag from '@/components/Plugins/PluginTag';
import { useToolStore } from '@/store/tool';
import { customPluginSelectors } from '@/store/tool/selectors';

import CheckboxItem, { type CheckboxItemProps } from '../components/CheckboxWithLoading';

const ToolItem = memo<CheckboxItemProps>(({ id, onUpdate, label, checked }) => {
  const isCustom = useToolStore((s) => customPluginSelectors.isCustomPlugin(id)(s));

  return (
    <Suspense fallback={<DebugNode trace="ActionBar/Tools/ToolItem" />}>
      <CheckboxItem
        checked={checked}
        hasPadding={false}
        id={id}
        label={
          <Flexbox align={'center'} gap={8} horizontal>
            {label || id}
            {isCustom && <PluginTag showText={false} type={'customPlugin'} />}
          </Flexbox>
        }
        onUpdate={onUpdate}
      />
    </Suspense>
  );
});

export default ToolItem;
