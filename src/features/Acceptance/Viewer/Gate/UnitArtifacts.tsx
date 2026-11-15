'use client';

import type { GoalReleaseGateUnit, WorkSummaryItem } from '@lobechat/types';
import { Block, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { ExternalLink, FileDown, FileText } from 'lucide-react';
import { createElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { taskDetailPath } from '@/features/AgentTasks/shared/taskDetailPath';
import { openDocumentModal } from '@/features/DocumentModal/loader';
import {
  getWorkTypeDescriptor,
  isSafeExternalUrl,
  WORK_TYPE_DESCRIPTORS,
  type WorkIcon,
} from '@/features/Work/descriptors';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';
import { useWorkspaceAwareNavigate } from '@/features/Workspace/useWorkspaceAwareNavigate';

import { unitArtifacts } from './dossier';

type Artifact = GoalReleaseGateUnit['artifacts'][number];
type ExternalItem = Parameters<(typeof WORK_TYPE_DESCRIPTORS)['external']['getIcon']>[0];

/** A pull request or issue draws its state (open / merged / …) the way the Work cards do. */
const externalItem = (artifact: Artifact) =>
  ({ resourceType: artifact.resourceType, status: artifact.status ?? null }) as ExternalItem;

const iconOf = (artifact: Artifact): WorkIcon =>
  artifact.type === 'external'
    ? WORK_TYPE_DESCRIPTORS.external.getIcon(externalItem(artifact))
    : artifact.type === 'document'
      ? FileText
      : artifact.type === 'file'
        ? FileDown
        : ExternalLink;

/**
 * Opens a unit's output where it lives. Not the Work gallery's `useOpenWork`:
 * that one reaches the canvas modal, whose runtime the share app (which also
 * serves this review) does not bundle. A canvas output stays where it is.
 */
const useOpenUnitWork = () => {
  const navigate = useWorkspaceAwareNavigate();
  return useCallback(
    (item: WorkSummaryItem) => {
      const target = getWorkTypeDescriptor(item).getOpenTarget(item);
      switch (target?.kind) {
        case 'document': {
          void openDocumentModal(target.documentId);
          return;
        }
        case 'external':
        case 'filePreview': {
          if (isSafeExternalUrl(target.url))
            window.open(target.url, '_blank', 'noopener,noreferrer');
          return;
        }
        case 'task': {
          navigate(taskDetailPath(target.identifier ?? target.taskId, undefined, target.name));
        }
      }
    },
    [navigate],
  );
};

const ArtifactRow = memo<{ artifact: Artifact }>(({ artifact }) => {
  const { t } = useTranslation('topic');
  const url = isSafeExternalUrl(artifact.url) ? artifact.url : undefined;
  const stateKey =
    artifact.type === 'external'
      ? WORK_TYPE_DESCRIPTORS.external.getStateLabelKey?.(externalItem(artifact))
      : undefined;
  return (
    <Block
      horizontal
      align={'center'}
      clickable={!!url}
      gap={8}
      padding={8}
      title={url}
      variant={'outlined'}
      onClick={url ? () => window.open(url, '_blank', 'noopener,noreferrer') : undefined}
    >
      {/* Icons are module-level components; picking one per row creates none. */}
      {createElement(iconOf(artifact), { size: 16 })}
      <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
        <Text ellipsis weight={500}>
          {artifact.title || artifact.identifier}
        </Text>
        {(artifact.identifier || stateKey) && (
          <Text fontSize={12} type={'secondary'}>
            {[artifact.identifier, stateKey && t(stateKey)].filter(Boolean).join(' · ')}
          </Text>
        )}
      </Flexbox>
      {url && <Icon color={cssVar.colorTextQuaternary} icon={ExternalLink} size={14} />}
    </Block>
  );
});

ArtifactRow.displayName = 'GateUnitArtifactRow';

/**
 * What a unit's run delivered — its PRs, documents, files — as the same Work
 * cards the conversation lists under a reply, each opened where it lives. A
 * dossier frozen before the cards were carried falls back to plain rows.
 */
const UnitArtifacts = memo<{ unit: GoalReleaseGateUnit }>(({ unit }) => {
  const { t } = useTranslation('verify');
  const openWork = useOpenUnitWork();
  const artifacts = unitArtifacts(unit);
  return (
    <Flexbox gap={4}>
      <Text fontSize={12} type={'secondary'}>
        {t('acceptance.gate.unitArtifacts')}
      </Text>
      {unit.works?.length ? (
        // The flat rows of the conversation's working sidebar: the panel is
        // narrow, and the rows' own inset lines their icons up with the label.
        <Flexbox style={{ marginInline: -8 }}>
          {unit.works.map((work) => (
            <WorkSummaryCard item={work} key={work.id} variant={'inline'} onOpen={openWork} />
          ))}
        </Flexbox>
      ) : artifacts.length > 0 ? (
        artifacts.map((artifact, index) => (
          <ArtifactRow artifact={artifact} key={artifact.url ?? `${artifact.title}-${index}`} />
        ))
      ) : (
        <Text fontSize={13} type={'secondary'}>
          {t('acceptance.gate.unitArtifactsEmpty')}
        </Text>
      )}
    </Flexbox>
  );
});

UnitArtifacts.displayName = 'GateUnitArtifacts';

export default UnitArtifacts;
