import { Button } from '@lobehub/ui/base-ui';
import { CheckCheckIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type BriefItem } from '@/features/DailyBrief/types';
import { useBriefStore } from '@/store/brief';

interface MarkAllReadButtonProps {
  news: BriefItem[];
}

/**
 * Clears the whole news pile in one click. Resolution happens with the neutral
 * `read` action — reports are knowledge, so dismissing them wholesale must
 * never accept a delivery or complete a task.
 */
const MarkAllReadButton = memo<MarkAllReadButtonProps>(({ news }) => {
  const { t } = useTranslation('home');
  const resolveBriefsAsRead = useBriefStore((s) => s.resolveBriefsAsRead);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      await resolveBriefsAsRead(news.map((brief) => brief.id));
    } finally {
      setLoading(false);
    }
  }, [news, resolveBriefsAsRead]);

  return (
    <Button
      disabled={loading}
      icon={CheckCheckIcon}
      size={'small'}
      type={'text'}
      onClick={handleClick}
    >
      {t('inbox.news.markAllRead')}
    </Button>
  );
});

export default MarkAllReadButton;
