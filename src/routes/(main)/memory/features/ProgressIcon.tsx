import { Flexbox, Tooltip } from '@lobehub/ui';
import type { ProgressProps } from '@lobehub/ui/base-ui';
import { Progress, Text } from '@lobehub/ui/base-ui';
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
      segments={5}
      showInfo={false}
      size={12}
      variant="segments"
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
