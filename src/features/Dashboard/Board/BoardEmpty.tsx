'use client';

import { AGENT_CHAT_URL } from '@lobechat/const';
import { Button, Center, Empty, Flexbox, Icon, Tag, toast } from '@lobehub/ui';
import {
  HashIcon,
  LayoutDashboardIcon,
  ListIcon,
  SparklesIcon,
  TableIcon,
  TrendingUpIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { queueDraftForMainComposer } from '@/features/Conversation/composerDraftBus';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';

/** The kinds of card a widget can put on a board, shown as what this board will hold. */
const CARD_KINDS = [
  { icon: HashIcon, key: 'stat' },
  { icon: ListIcon, key: 'list' },
  { icon: TrendingUpIcon, key: 'series' },
  { icon: TableIcon, key: 'table' },
] as const;

interface BoardEmptyProps {
  /** The board's name, written into the prompt so the agent places the widget here. */
  title?: string;
}

/**
 * A board with no widgets yet: what a widget is, the cards it can show, and
 * the way to get one — asking an agent, which writes, dry-runs and (after the
 * user approves) publishes it onto this board. Users who cannot create
 * content get the explanation without the action.
 */
const BoardEmpty = ({ title }: BoardEmptyProps) => {
  const { t } = useTranslation('dashboard');
  const navigate = useWorkspaceAwareNavigate();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);
  const { allowed: canCreate } = usePermission('create_content');

  const handleCreate = () => {
    if (!inboxAgentId) {
      toast.error(t('board.emptyAgentUnavailable'));
      return;
    }
    queueDraftForMainComposer(t('board.emptyPrompt', { title: title ?? '' }), {
      agentId: inboxAgentId,
    });
    navigate(AGENT_CHAT_URL(inboxAgentId));
  };

  return (
    <Center data-dashboard-board-empty flex={1} padding={48}>
      <Empty
        align={'center'}
        description={t('board.emptyDescription')}
        descriptionProps={{ style: { textAlign: 'center' } }}
        icon={LayoutDashboardIcon}
        style={{ maxWidth: 440 }}
        title={t('board.emptyTitle')}
        action={
          <Flexbox align={'center'} gap={16}>
            <Flexbox horizontal gap={6} justify={'center'} wrap={'wrap'}>
              {CARD_KINDS.map(({ icon, key }) => (
                <Tag icon={<Icon icon={icon} />} key={key}>
                  {t(`board.emptyKind.${key}`)}
                </Tag>
              ))}
            </Flexbox>
            {canCreate && (
              <Button
                data-dashboard-board-empty-create
                icon={SparklesIcon}
                type={'primary'}
                onClick={handleCreate}
              >
                {t('board.emptyAction')}
              </Button>
            )}
          </Flexbox>
        }
      />
    </Center>
  );
};

export default BoardEmpty;
