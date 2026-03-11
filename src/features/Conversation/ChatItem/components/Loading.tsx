import { Flexbox, Icon } from '@lobehub/ui';
import { Loader2 } from 'lucide-react';
import { memo } from 'react';

import { styles } from '../style';
import { type ChatItemProps } from '../type';

export interface LoadingProps {
  loading?: ChatItemProps['loading'];
  placement?: ChatItemProps['placement'];
}

const Loading = memo<LoadingProps>(({ loading }) => {
  if (!loading) return null;

  return (
    <Flexbox align={'center'} className={styles.loading} justify={'center'}>
      <Icon spin icon={Loader2} size={{ size: 12, strokeWidth: 3 }} />
    </Flexbox>
  );
});

export default Loading;
