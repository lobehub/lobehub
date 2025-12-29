import { ActionIcon } from '@lobehub/ui';
import { cx } from 'antd-style';
import { ArrowDownIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { styles } from './style';

export interface BackBottomProps {
  onScrollToBottom: () => void;
  visible: boolean;
}

const BackBottom = memo<BackBottomProps>(({ visible, onScrollToBottom }) => {
  const { t } = useTranslation('chat');

  return (
    <ActionIcon
      className={cx(styles.container, visible && styles.visible)}
      glass
      icon={ArrowDownIcon}
      onClick={onScrollToBottom}
      size={{
        blockSize: 36,
        borderRadius: 36,
        size: 18,
      }}
      title={t('backToBottom')}
      variant={'outlined'}
    />
  );
});

export default BackBottom;
