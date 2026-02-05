import { Flexbox, Icon, SliderWithInput } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { BookOpenText, FileIcon } from 'lucide-react';
import { memo } from 'react';

interface FrequencyPenaltyProps {
  disabled?: boolean;
  onChange?: (value: number) => void;
  value?: number;
}

const FrequencyPenalty = memo<FrequencyPenaltyProps>(({ value, onChange, disabled }) => {
  return (
    <Flexbox style={{ width: '100%' }}>
      <SliderWithInput
        changeOnWheel
        controls={false}
        disabled={disabled}
        max={2}
        min={-2}
        size={'small'}
        step={0.1}
        style={{ height: 42 }}
        value={value}
        marks={{
          '-2': (
            <Icon icon={FileIcon} size={'small'} style={{ color: cssVar.colorTextQuaternary }} />
          ),
          0: <div />,
          2: (
            <Icon
              icon={BookOpenText}
              size={'small'}
              style={{ color: cssVar.colorTextQuaternary }}
            />
          ),
        }}
        styles={{
          input: {
            maxWidth: 43,
          },
        }}
        onChange={onChange}
      />
    </Flexbox>
  );
});
export default FrequencyPenalty;
