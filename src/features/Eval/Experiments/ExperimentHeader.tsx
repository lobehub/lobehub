'use client';

import type { AgentEvalExperimentDetail } from '@lobechat/types';
import { Flexbox } from '@lobehub/ui';
import {
  ActionIcon,
  Button,
  confirmModal,
  type DropdownItem,
  DropdownMenu,
  toast,
} from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { ArrowLeft, Ellipsis, FlaskConical, Pencil, Trash2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { EvalPageHeader } from '@/features/Eval/components/EvalPage';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';
import WorkspaceLink from '@/features/Workspace/WorkspaceLink';
import { useEvalStore } from '@/store/eval';

import { createExperimentModal } from './ExperimentCreateModal';

const styles = createStaticStyles(({ css }) => ({
  back: css`
    color: ${cssVar.colorTextTertiary};
    text-decoration: none;

    &:hover {
      color: ${cssVar.colorText};
    }
  `,
  icon: css`
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: ${cssVar.borderRadiusLG};

    color: ${cssVar.colorTextSecondary};

    background: ${cssVar.colorFillTertiary};
  `,
  meta: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
}));

interface ExperimentHeaderProps {
  experiment: AgentEvalExperimentDetail;
}

const ExperimentHeader = memo<ExperimentHeaderProps>(({ experiment }) => {
  const { t } = useTranslation('eval');
  const navigate = useWorkspaceAwareNavigate();
  const deleteExperiment = useEvalStore((s) => s.deleteExperiment);

  const menuItems: DropdownItem[] = [
    {
      danger: true,
      icon: <Trash2 size={16} />,
      key: 'delete',
      label: t('common.delete'),
      onClick: () =>
        confirmModal({
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
              toast.error(t('experiment.delete.error'));
            }
          },
          title: t('experiment.actions.delete'),
        }),
    },
  ];

  return (
    <EvalPageHeader
      description={experiment.description || undefined}
      title={experiment.name}
      actions={
        <>
          <Button icon={Pencil} onClick={() => createExperimentModal({ experiment })}>
            {t('common.edit')}
          </Button>
          <DropdownMenu items={menuItems} trigger={['click']}>
            <ActionIcon icon={Ellipsis} title={t('experiment.actions.delete')} />
          </DropdownMenu>
        </>
      }
      breadcrumb={
        <WorkspaceLink className={styles.back} to={'/eval'}>
          <Flexbox horizontal align="center" gap={4}>
            <ArrowLeft size={14} />
            {t('dataset.detail.backToEval')}
          </Flexbox>
        </WorkspaceLink>
      }
      icon={
        <div className={styles.icon}>
          <FlaskConical size={20} />
        </div>
      }
      meta={
        <span className={styles.meta}>
          {t('experiment.detail.lastAccessed', {
            time: new Date(experiment.accessedAt).toLocaleString(),
          })}
        </span>
      }
    />
  );
});

export default ExperimentHeader;
