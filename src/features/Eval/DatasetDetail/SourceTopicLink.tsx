'use client';

import { toast } from '@lobehub/ui/base-ui';
import { MessagesSquare } from 'lucide-react';
import { type MouseEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { topicService } from '@/services/topic';

import { styles } from './style';

/**
 * Opens the conversation a case was saved from. The case only stores the topic
 * id, and a topic route needs its agent — so it resolves on click rather than
 * fetching every row's topic up front.
 */
const SourceTopicLink = ({ topicId }: { topicId: string }) => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const [loading, setLoading] = useState(false);

  const handleClick = async (event: MouseEvent) => {
    event.stopPropagation();
    setLoading(true);
    try {
      const topic = await topicService.getTopicDetail(topicId);
      const agentId = (topic as { agentId?: string | null } | null)?.agentId;
      if (!agentId) {
        toast.error(t('dataset.case.sourceMissing'));
        return;
      }
      navigate(`/agent/${agentId}/${topicId}`);
    } catch {
      toast.error(t('dataset.case.sourceMissing'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      className={styles.linkButton}
      disabled={loading}
      type="button"
      onClick={handleClick}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <MessagesSquare size={12} />
      {t('dataset.case.source')}
    </button>
  );
};

export default SourceTopicLink;
