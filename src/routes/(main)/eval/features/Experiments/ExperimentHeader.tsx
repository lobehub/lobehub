'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { Flexbox, Text } from '@lobehub/ui';
import { Button, type DropdownItem, DropdownMenu } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { createStaticStyles, cssVar } from 'antd-style';
import { Ellipsis, Pencil, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import { useEvalStore } from '@/store/eval';

import { createExperimentModal } from './ExperimentCreateModal';

const styles = createStaticStyles(({ css }) => ({
  meta: css`
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface ExperimentHeaderProps {
  experiment: AgentEvalExperimentDetail;
}

const ExperimentHeader = memo<ExperimentHeaderProps>(({ experiment }) => {
  const { t } = useTranslation('eval');
  const { message, modal } = App.useApp();
  const navigate = useWorkspaceAwareNavigate();
  const deleteExperiment = useEvalStore((s) => s.deleteExperiment);

  const menuItems: DropdownItem[] = [
    {
      danger: true,
      icon: <Trash2 size={16} />,
      key: 'delete',
      label: t('common.delete'),
      onClick: () =>
        modal.confirm({
          content: t('experiment.actions.delete.confirm'),
          okButtonProps: { danger: true },
          okText: t('experiment.actions.delete'),
          onOk: async () => {
            try {
              await deleteExperiment(experiment.id);
              navigate('/eval');
            } catch {
              // Optimistic removal surfaces its failure here (ux Act) — stay
              // on the page and let the user retry instead of navigating away.
              message.error(t('experiment.delete.error'));
            }
          },
          title: t('experiment.actions.delete'),
        }),
    },
  ];

  return (
    <Flexbox horizontal align="start" justify="space-between">
      <Flexbox gap={6} style={{ minWidth: 0 }}>
        <Text as="h3" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          {experiment.name}
        </Text>
        {experiment.description && <Text type="secondary">{experiment.description}</Text>}
        <span className={styles.meta}>
          {t('experiment.detail.lastAccessed', {
            time: new Date(experiment.accessedAt).toLocaleString(),
          })}
        </span>
      </Flexbox>
      <Flexbox horizontal gap={8}>
        <Button icon={Pencil} onClick={() => createExperimentModal({ experiment })}>
          {t('common.edit')}
        </Button>
        <DropdownMenu items={menuItems} trigger={['click']}>
          <Button icon={Ellipsis} />
        </DropdownMenu>
      </Flexbox>
    </Flexbox>
  );
});

export default ExperimentHeader;
