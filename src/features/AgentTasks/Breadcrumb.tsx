import { Icon } from '@lobehub/ui';
import { Breadcrumb as AntBreadcrumb } from 'antd';
import { cssVar } from 'antd-style';
import { ClipboardList } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import { styles } from './style';

interface BreadcrumbProps {
  agentId: string;
}

const Breadcrumb = memo<BreadcrumbProps>(({ agentId }) => {
  const { t } = useTranslation('chat');
  const agentMeta = useAgentStore(agentSelectors.currentAgentMeta);
  const agentName = agentMeta?.title || 'Agent';

  return (
    <div className={styles.breadcrumb}>
      <AntBreadcrumb
        items={[
          {
            title: (
              <Link style={{ color: cssVar.colorTextSecondary }} to={`/agent/${agentId}`}>
                <Icon icon={ClipboardList} size={14} style={{ marginInlineEnd: 4 }} />
                {agentName}
              </Link>
            ),
          },
          {
            title: t('taskList.breadcrumb.task'),
          },
        ]}
      />
    </div>
  );
});

export default Breadcrumb;
