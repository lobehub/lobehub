import { Button, toast } from '@lobehub/ui';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function useExplainTopicAction(shareId: string) {
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

  return { copyPrompt, loading, label: t('sharePage.explain.action') };
}

export default function ExplainTopic({
  action,
}: {
  action: ReturnType<typeof useExplainTopicAction>;
}) {
  const { copyPrompt, loading, label } = action;
  return (
    <Button icon={Sparkles} loading={loading} size={'small'} type={'fill'} onClick={copyPrompt}>
      {label}
    </Button>
  );
}
