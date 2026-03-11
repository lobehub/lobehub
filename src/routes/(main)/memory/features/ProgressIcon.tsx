import { Flexbox, Text, Tooltip } from '@lobehub/ui';
import { type ProgressProps } from 'antd';
import { Progress } from 'antd';
import { cssVar } from 'antd-style';
import { memo } from 'react';

interface ProgressIconProps extends Omit<ProgressProps, 'percent'> {
  percent?: number | null;
}

const ProgressIcon = memo<ProgressIconProps>(({ showInfo, format, percent, ...rest }) => {
  if (typeof percent !== 'number') return;

  const content = (
    <Progress
      format={format}
      percent={percent}
      showInfo={false}
      size={[2, 12]}
      steps={5}
      {...rest}
    />
  );

  if (showInfo)
    return (
      <Flexbox horizontal align={'center'} gap={8}>
        {content}
        <Text color={cssVar.colorTextSecondary} fontSize={12}>
          {format?.(percent)}
        </Text>
      </Flexbox>
    );

  return <Tooltip title={format?.(percent)}>{content}</Tooltip>;
});

export default ProgressIcon;
