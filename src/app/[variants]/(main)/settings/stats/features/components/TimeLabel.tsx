import { Flexbox, Icon } from '@lobehub/ui';
import { cssVar } from 'antd-style';
import { type LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { memo } from 'react';

const TimeLabel = memo<{
  date?: string;
  icon: LucideIcon;
  title: string;
}>(({ date, icon, title }) => {
  return (
    <Flexbox
      horizontal
      align={'center'}
      gap={4}
      style={{
        color: cssVar.colorTextDescription,
        fontSize: 12,
      }}
    >
      <Icon icon={icon} />
      {title}:{' '}
      {date ? <span style={{ fontWeight: 'bold' }}>{date}</span> : <Icon spin icon={Loader2} />}
    </Flexbox>
  );
});

export default TimeLabel;
