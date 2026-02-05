import { Flexbox, Icon, SliderWithInput } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { AtomIcon, RepeatIcon } from 'lucide-react';
import { memo } from 'react';

interface PresencePenaltyProps {
  disabled?: boolean;
  onChange?: (value: number) => void;
  value?: number;
}

const PresencePenalty = memo<PresencePenaltyProps>(({ value, onChange, disabled }) => {
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
            <Icon icon={RepeatIcon} size={'small'} style={{ color: cssVar.colorTextQuaternary }} />
          ),
          0: <div />,
          2: <Icon icon={AtomIcon} size={'small'} style={{ color: cssVar.colorTextQuaternary }} />,
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
export default PresencePenalty;
