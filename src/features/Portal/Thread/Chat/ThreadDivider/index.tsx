import { Icon } from '@lobehub/ui';
import { Tag } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { GitBranch } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const ThreadDivider = memo(() => {
  const { t } = useTranslation('chat');

  return (
    <div style={{ padding: '0 20px' }}>
      <Divider style={{ margin: 0, padding: '20px 0' }}>
        <Tag icon={<Icon icon={GitBranch} />}>{t('thread.divider')}</Tag>
      </Divider>
    </div>
  );
});

export default ThreadDivider;
