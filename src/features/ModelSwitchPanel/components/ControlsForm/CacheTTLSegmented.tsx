import { Segmented } from '@lobehub/ui/base-ui';
import { memo } from 'react';

type CacheTTL = '5m' | '1h';

interface CacheTTLSegmentedProps {
  disabled?: boolean;
  onChange?: (value: CacheTTL) => void;
  value?: CacheTTL;
}

const CacheTTLSegmented = memo<CacheTTLSegmentedProps>(({ disabled, value, onChange }) => {
  return (
    <Segmented<CacheTTL>
      disabled={disabled}
      size={'small'}
      value={value ?? '5m'}
      options={[
        { label: '5m', value: '5m' },
        { label: '1h', value: '1h' },
      ]}
      onChange={(ttl) => onChange?.(ttl)}
    />
  );
});

export default CacheTTLSegmented;
