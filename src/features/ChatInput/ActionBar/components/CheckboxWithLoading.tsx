import { Center, Checkbox, Flexbox, Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo, useState } from 'react';

export interface CheckboxItemProps {
  checked?: boolean;
  hasPadding?: boolean;
  id: string;
  label?: ReactNode;
  labelMaxWidth?: CSSProperties['maxWidth'];
  onUpdate: (id: string, enabled: boolean) => Promise<void>;
}

const CheckboxItem = memo<CheckboxItemProps>(
  ({ id, onUpdate, label, checked, hasPadding = true, labelMaxWidth }) => {
    const [loading, setLoading] = useState(false);
    const labelContent = label || id;

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
                minWidth: 0,
                paddingLeft: 8,
              }
            : { minWidth: 0 }
        }
        onClick={async (e) => {
          e.stopPropagation();
          updateState();
        }}
      >
        <span
          title={typeof labelContent === 'string' ? labelContent : undefined}
          style={{
            maxWidth: labelMaxWidth,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {labelContent}
        </span>
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
