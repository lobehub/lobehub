import { Icon, Tag } from '@lobehub/ui';
import { ShieldCheck } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const SessionBypassBadge = memo(() => {
  const { t } = useTranslation('chat');
  return (
    <Tag icon={<Icon icon={ShieldCheck} />} size="small">
      {t('tool.intervention.sessionBypassed')}
    </Tag>
  );
});

export default SessionBypassBadge;
