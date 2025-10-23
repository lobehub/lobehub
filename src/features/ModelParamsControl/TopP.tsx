import { Icon, SliderWithInput } from '@lobehub/ui';
import { useTheme } from 'antd-style';
import { FlowerIcon, TrainFrontTunnel } from 'lucide-react';
import { memo } from 'react';
import { Flexbox } from 'react-layout-kit';

interface TopPProps {
  disabled?: boolean;
  onChange?: (value: number) => void;
  value?: number;
}

const TopP = memo<TopPProps>(({ value, onChange, disabled }) => {
  const theme = useTheme();

  return (
    <Flexbox style={{ width: '100%' }}>
      <SliderWithInput
        changeOnWheel
        controls={false}
        disabled={disabled}
        marks={{
          0: (
            <Icon
              icon={TrainFrontTunnel}
              size={'small'}
              style={{ color: theme.colorTextQuaternary }}
            />
          ),
          0.9: <div />,
          1: <Icon icon={FlowerIcon} size={'small'} style={{ color: theme.colorTextQuaternary }} />,
        }}
        max={1}
        min={0}
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
export default TopP;
