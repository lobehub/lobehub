import { Icon, SliderWithInput } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { AtomIcon, RepeatIcon } from 'lucide-react';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

interface PresencePenaltyProps {
  disabled?: boolean;
  onChange?: (value: number) => void;
  value?: number;
}

const PresencePenalty = memo<PresencePenaltyProps>(({ value, onChange, disabled }) => {
  const theme = useTheme();

  return (
    <Flexbox style={{ width: '100%' }}>
      <SliderWithInput
        changeOnWheel
        controls={false}
        disabled={disabled}
        marks={{
          '-2': (
            <Icon icon={RepeatIcon} size={'small'} style={{ color: theme.colorTextQuaternary }} />
          ),
          0: <div />,
          2: <Icon icon={AtomIcon} size={'small'} style={{ color: theme.colorTextQuaternary }} />,
        }}
        max={2}
        min={-2}
        onChange={onChange}
        size={'small'}
        step={0.1}
        style={{ height: 42 }}
        styles={{
          input: {
            maxWidth: 43,
          },
        }}
        value={value}
      />
    </Flexbox>
  );
});
export default PresencePenalty;
