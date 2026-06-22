import { Center, Checkbox, Flexbox, Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { type CSSProperties, type ReactNode } from 'react';
import { memo, useState } from 'react';

export interface CheckboxItemProps {
  checked?: boolean;
  disabled?: boolean;
  hasPadding?: boolean;
  id: string;
  label?: ReactNode;
  labelMaxWidth?: CSSProperties['maxWidth'];
  onUpdate: (id: string, enabled: boolean) => Promise<void>;
}

// Keep the file extension (and a few trailing characters) readable by ellipsizing
// the MIDDLE of the name instead of the tail — "2024-quarterly-report-final.pdf"
// truncates to "2024-quarterly…final.pdf" rather than hiding the ".pdf". Pure CSS:
// the head flex-shrinks with an ellipsis while the fixed-width tail stays pinned.
const TRUNCATE_TAIL_LENGTH = 8;

const MiddleEllipsis = memo<{ text: string }>(({ text }) => {
  // Short names gain nothing from middle truncation — render them in one piece.
  if (text.length <= TRUNCATE_TAIL_LENGTH + 1) {
    return <span style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}>{text}</span>;
  }

  const head = text.slice(0, -TRUNCATE_TAIL_LENGTH);
  const tail = text.slice(-TRUNCATE_TAIL_LENGTH);

  return (
    <>
      <span
        style={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {head}
      </span>
      <span style={{ flex: 'none', whiteSpace: 'nowrap' }}>{tail}</span>
    </>
  );
});

MiddleEllipsis.displayName = 'MiddleEllipsis';

const CheckboxItem = memo<CheckboxItemProps>(
  ({ id, onUpdate, label, checked, disabled, hasPadding = true, labelMaxWidth }) => {
    const [loading, setLoading] = useState(false);
    const labelContent = label || id;

    const updateState = async () => {
      if (disabled) return;

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
          if (disabled) return;

          updateState();
        }}
      >
        <span
          title={typeof labelContent === 'string' ? labelContent : undefined}
          style={{
            display: 'flex',
            maxWidth: labelMaxWidth,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          {typeof labelContent === 'string' ? <MiddleEllipsis text={labelContent} /> : labelContent}
        </span>
        {loading ? (
          <Center width={18}>
            <Icon spin icon={Loader2} />
          </Center>
        ) : (
          <Checkbox
            checked={checked}
            disabled={disabled}
            onClick={async (e) => {
              e.stopPropagation();
              if (disabled) return;

              await updateState();
            }}
          />
        )}
      </Flexbox>
    );
  },
);

export default CheckboxItem;
