import { Center, Checkbox, Flexbox, Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type ReactNode } from 'react';
import { memo, useState } from 'react';

export interface CheckboxItemProps {
  checked?: boolean;
  hasPadding?: boolean;
  id: string;
  label?: ReactNode;
  onUpdate: (id: string, enabled: boolean) => Promise<void>;
}

const CheckboxItem = memo<CheckboxItemProps>(
  ({ id, onUpdate, label, checked, hasPadding = true }) => {
    const [loading, setLoading] = useState(false);

    const updateState = async () => {
      setLoading(true);
      await onUpdate(id, !checked);
      setLoading(false);
    };

    return (
      <Flexbox
        horizontal
        align={'center'}
        gap={24}
        justify={'space-between'}
        style={
          hasPadding
            ? {
                paddingLeft: 8,
              }
            : void 0
        }
        onClick={async (e) => {
          e.stopPropagation();
          updateState();
        }}
      >
        {label || id}
        {loading ? (
          <Center width={18}>
            <Icon spin icon={Loader2} />
          </Center>
        ) : (
          <Checkbox
            checked={checked}
            onClick={async (e) => {
              e.stopPropagation();
              await updateState();
            }}
          />
        )}
      </Flexbox>
    );
  },
);

export default CheckboxItem;
