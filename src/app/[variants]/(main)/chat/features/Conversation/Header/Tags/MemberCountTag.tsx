import { Flexbox, Icon, Tag, Tooltip } from '@lobehub/ui';
import { Users } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSessionStore } from '@/store/session';
import { sessionSelectors } from '@/store/session/selectors';
import { type LobeGroupSession } from '@/types/session';

const MemberCountTag = memo(() => {
  const { t } = useTranslation('chat');
  const currentSession = useSessionStore(sessionSelectors.currentSession);

  const memberCount = (currentSession as LobeGroupSession).members?.length ?? 0 + 1;

  if (memberCount < 0) return null;

  return (
    <Tooltip title={t('group.memberTooltip', { count: memberCount })}>
      <Flexbox height={22}>
        <Tag>
          <Icon icon={Users} />
          <span>{memberCount}</span>
        </Tag>
      </Flexbox>
    </Tooltip>
  );
});

export default MemberCountTag;
