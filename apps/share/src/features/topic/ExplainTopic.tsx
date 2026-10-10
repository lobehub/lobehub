import { Button, toast } from '@lobehub/ui';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function ExplainTopic({ shareId }: { shareId: string }) {
  const { t } = useTranslation('chat');
  const [loading, setLoading] = useState(false);

  const copyPrompt = async () => {
    setLoading(true);
    try {
      const url = new URL(
        `/share/t/${encodeURIComponent(shareId)}/llm.txt`,
        window.location.origin,
      );
      await navigator.clipboard.writeText(t('sharePage.explain.prompt', { url: url.href }));
      toast.success(t('sharePage.explain.copied'));
    } catch {
      toast.error(t('sharePage.explain.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button icon={Sparkles} loading={loading} size={'small'} type={'fill'} onClick={copyPrompt}>
      {t('sharePage.explain.action')}
    </Button>
  );
}
