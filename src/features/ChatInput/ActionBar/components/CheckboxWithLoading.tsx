import { Center, Checkbox, Flexbox, Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type ReactNode, memo, useState } from 'react';

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
        align={'center'}
        gap={24}
        horizontal
        justify={'space-between'}
        onClick={async (e) => {
          e.stopPropagation();
          updateState();
        }}
        style={
          hasPadding
            ? {
                paddingLeft: 8,
              }
            : void 0
        }
      >
        {label || id}
        {loading ? (
          <Center width={18}>
            <Icon icon={Loader2} spin />
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
