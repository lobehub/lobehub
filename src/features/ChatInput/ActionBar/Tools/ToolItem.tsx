import { Flexbox } from '@lobehub/ui';
import { memo } from 'react';

import PluginTag from '@/components/Plugins/PluginTag';
import { useToolStore } from '@/store/tool';
import { customPluginSelectors } from '@/store/tool/selectors';

import CheckboxItem, { type CheckboxItemProps } from '../components/CheckbokWithLoading';

const ToolItem = memo<CheckboxItemProps>(({ id, onUpdate, label, checked }) => {
  const isCustom = useToolStore((s) => customPluginSelectors.isCustomPlugin(id)(s));

  return (
    <CheckboxItem
      checked={checked}
      id={id}
      label={
        <Flexbox align={'center'} gap={8} horizontal>
          {label || id}
          {isCustom && <PluginTag showText={false} type={'customPlugin'} />}
        </Flexbox>
      }
      onUpdate={onUpdate}
    />
  );
});

export default ToolItem;
