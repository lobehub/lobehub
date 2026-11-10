'use client';

import type { GoalReleaseGateUnit } from '@lobechat/types';
import { Block, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { ExternalLink, FileDown, FileText } from 'lucide-react';
import { createElement, memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  isSafeExternalUrl,
  WORK_TYPE_DESCRIPTORS,
  type WorkIcon,
} from '@/features/Work/descriptors';
import WorkSummaryCard from '@/features/Work/WorkSummaryCard';
import { useOpenWork } from '@/features/WorkGallery/useOpenWork';

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
  const openWork = useOpenWork();
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
