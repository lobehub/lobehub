'use client';

import { type AgentItem } from '@lobechat/types';
import { ModelIcon } from '@lobehub/icons';
import { ActionIcon, Flexbox, Icon, Popover, Skeleton, Text } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { createStaticStyles } from 'antd-style';
import { BookOpen, FileText, Settings } from 'lucide-react';
import { memo, type PropsWithChildren, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

import ModelSelect from '@/features/ModelSelect';
import { useResourceAccess } from '@/features/ResourcePermission/useResourceAccess';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { usePermission } from '@/hooks/usePermission';
import { agentProfileKeys } from '@/libs/swr/keys';
import { agentService } from '@/services/agent';
import { useAgentGroupStore } from '@/store/agentGroup';

import AgentProfileCard from '.';

const styles = createStaticStyles(({ css, cssVar }) => ({
  footer: css`
    padding-block: 12px;
    padding-inline: 16px;
    border-block-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  section: css`
    padding-block: 12px;
    padding-inline: 16px;
  `,
  sectionTitle: css`
    margin-block-end: 8px;

    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
  `,
  statItem: css`
    color: ${cssVar.colorTextSecondary};
  `,
  trigger: css`
    border-radius: ${cssVar.borderRadius};

    &[data-popup-open] {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

type AgentPreview = Pick<
  AgentItem,
  'avatar' | 'backgroundColor' | 'description' | 'model' | 'provider' | 'title'
>;

interface FetchedAgent extends Partial<AgentPreview> {
  files?: unknown[];
  id?: string;
  knowledgeBases?: unknown[];
  plugins?: string[];
}

interface AgentProfilePopupProps extends PropsWithChildren {
  /** Prefilled data for instant render; fetched data overrides once loaded. */
  agent?: Partial<AgentPreview>;
  agentId: string;
  /** When set, enables group-specific actions (settings nav + model change). */
  groupId?: string;
  trigger?: 'click' | 'hover';
}

const AgentProfilePopup = memo<AgentProfilePopupProps>(
  ({ agent, agentId, groupId, children, trigger = 'click' }) => {
    const { t } = useTranslation('chat');
    const navigate = useWorkspaceAwareNavigate();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const { allowed: canEditContent } = usePermission('edit_own_content');
    const { canEditResource: canEditAgent, isAccessResolved: isAgentAccessResolved } =
      useResourceAccess('agent', open ? agentId : undefined);
    const { canEditResource: canEditGroup, isAccessResolved: isGroupAccessResolved } =
      useResourceAccess('agentGroup', open ? groupId : undefined);
    const canConfigure =
      canEditContent &&
      isAgentAccessResolved &&
      canEditAgent &&
      (!groupId || (isGroupAccessResolved && canEditGroup));

    const updateMemberAgentConfig = useAgentGroupStore((s) => s.updateMemberAgentConfig);

    const { data: fetched, isLoading } = useSWR(
      open && canConfigure ? agentProfileKeys.detail(agentId) : null,
      () => agentService.getAgentConfigById(agentId) as Promise<FetchedAgent | null>,
      { revalidateOnFocus: false },
    );

    const merged: Partial<AgentPreview> = {
      avatar: fetched?.avatar ?? agent?.avatar,
      backgroundColor: fetched?.backgroundColor ?? agent?.backgroundColor,
      description: fetched?.description ?? agent?.description,
      model: fetched?.model ?? agent?.model,
      provider: fetched?.provider ?? agent?.provider,
      title: fetched?.title ?? agent?.title,
    };

    const handleModelChange = async (props: { model: string; provider: string }) => {
      if (!groupId || !canConfigure) return;
      setLoading(true);
      try {
        await updateMemberAgentConfig(groupId, agentId, {
          model: props.model,
          provider: props.provider,
        });
      } finally {
        setLoading(false);
      }
    };

    const handleSettings = () => {
      if (!groupId || !canConfigure) return;
      if (!canConfigure) return;
      setOpen(false);
      navigate(`/group/${groupId}/profile?tab=${agentId}`);
    };

    const handleHeaderClick = () => {
      setOpen(false);
      navigate(`/agent/${agentId}/profile`);
    };

    const hasDisplay = Boolean(merged.title || merged.avatar || merged.description);
    const showSkeleton = !hasDisplay && isLoading;

    const pluginCount = fetched?.plugins?.length ?? 0;
    const knowledgeCount = fetched?.knowledgeBases?.length ?? 0;
    const fileCount = fetched?.files?.length ?? 0;
    const hasStats = pluginCount > 0 || knowledgeCount > 0 || fileCount > 0;

    const footerLoading = canConfigure && !groupId && isLoading && !fetched;

    const modelSection =
      canConfigure && groupId ? (
        merged.model && (
          <Flexbox className={styles.section} gap={4}>
            <div className={styles.sectionTitle}>{t('groupSidebar.agentProfile.model')}</div>
            <ModelSelect
              loading={loading}
              value={{ model: merged.model, provider: merged.provider ?? undefined }}
              onChange={handleModelChange}
            />
          </Flexbox>
        )
      ) : footerLoading ? (
        <Flexbox horizontal align={'center'} className={styles.footer} gap={14}>
          <Skeleton.Button active size={'small'} style={{ height: 16, width: 90 }} />
          <Skeleton.Button active size={'small'} style={{ height: 16, width: 60 }} />
        </Flexbox>
      ) : canConfigure && (merged.model || hasStats) ? (
        <Flexbox horizontal align={'center'} className={styles.footer} gap={14} wrap={'wrap'}>
          {merged.model && (
            <Flexbox horizontal align={'center'} className={styles.statItem} gap={6}>
              <ModelIcon model={merged.model} size={14} />
              <Text fontSize={12} type={'secondary'}>
                {merged.model}
              </Text>
            </Flexbox>
          )}
          {pluginCount > 0 && (
            <Flexbox horizontal align={'center'} className={styles.statItem} gap={4}>
              <Icon icon={SkillsIcon} size={13} />
              <Text fontSize={12} type={'secondary'}>
                {t('agentProfile.skills', { count: pluginCount })}
              </Text>
            </Flexbox>
          )}
          {knowledgeCount > 0 && (
            <Flexbox horizontal align={'center'} className={styles.statItem} gap={4}>
              <Icon icon={BookOpen} size={13} />
              <Text fontSize={12} type={'secondary'}>
                {t('agentProfile.knowledgeBases', { count: knowledgeCount })}
              </Text>
            </Flexbox>
          )}
          {fileCount > 0 && (
            <Flexbox horizontal align={'center'} className={styles.statItem} gap={4}>
              <Icon icon={FileText} size={13} />
              <Text fontSize={12} type={'secondary'}>
                {t('agentProfile.files', { count: fileCount })}
              </Text>
            </Flexbox>
          )}
        </Flexbox>
      ) : null;

    const content = showSkeleton ? (
      <div style={{ padding: 16, width: 280 }}>
        <Skeleton active avatar paragraph={{ rows: 2 }} />
      </div>
    ) : (
      <AgentProfileCard
        avatar={merged.avatar}
        backgroundColor={merged.backgroundColor}
        description={merged.description}
        loading={isLoading && !merged.description}
        title={merged.title || t('defaultSession', { ns: 'common' })}
        headerAction={
          groupId && canConfigure ? (
            <Flexbox horizontal align="center" justify="flex-end" style={{ paddingBlockStart: 0 }}>
              <ActionIcon
                icon={Settings}
                size="small"
                title={t('groupSidebar.agentProfile.settings')}
                onClick={handleSettings}
              />
            </Flexbox>
          ) : undefined
        }
        onHeaderClick={canConfigure ? handleHeaderClick : undefined}
      >
        {modelSection}
      </AgentProfileCard>
    );

    return (
      <Popover
        classNames={trigger === 'click' ? { trigger: styles.trigger } : undefined}
        content={content}
        nativeButton={false}
        open={open}
        placement={trigger === 'hover' ? 'top' : 'right'}
        trigger={trigger}
        styles={{
          content: { borderRadius: 12, overflow: 'hidden', padding: 0 },
        }}
        onOpenChange={setOpen}
      >
        {children}
      </Popover>
    );
  },
);

export default AgentProfilePopup;
