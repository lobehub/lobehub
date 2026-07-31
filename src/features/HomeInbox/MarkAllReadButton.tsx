import { Button, toast } from '@lobehub/ui/base-ui';
import { CheckCheckIcon } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useBriefStore } from '@/store/brief';

interface MarkAllReadButtonProps {
  briefIds: string[];
  /** Fired after the resolve lands — lets the day digest revalidate its own SWR cache. */
  onResolved?: () => void;
}

/**
 * Clears the whole news pile in one click. Resolution happens with the neutral
 * `read` action — reports are knowledge, so dismissing them wholesale must
 * never accept a delivery or complete a task.
 */
const MarkAllReadButton = memo<MarkAllReadButtonProps>(({ briefIds, onResolved }) => {
  const { t } = useTranslation('home');
  const resolveBriefsAsRead = useBriefStore((s) => s.resolveBriefsAsRead);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      await resolveBriefsAsRead(briefIds);
      onResolved?.();
    } catch (error) {
      // Without this the button just stops spinning and the pile stays put —
      // the tRPC client only console.errors non-401 failures.
      toast.error((error as Error)?.message || t('brief.actionFailed'));
    } finally {
      setLoading(false);
    }
  }, [briefIds, onResolved, resolveBriefsAsRead, t]);

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
