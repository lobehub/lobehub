'use client';

import { cssVar, Icon, Tooltip } from '@lobehub/ui';
import {
  CircleCheck,
  CircleDashed,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  Link2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { DeliverableItem } from './deliverableList';
import type { GoalArtifactView } from './goalGraphViewModel';

const extensionOf = (artifact: GoalArtifactView) =>
  (artifact.title || artifact.identifier || '').match(/\.([\da-z]+)$/i)?.[1]?.toLowerCase();

/** The short format label a file card shows — `ZIP`, `PNG`, `XLSX`… */
export const fileFormatOf = (artifact: GoalArtifactView): string | undefined =>
  extensionOf(artifact)?.toUpperCase() ?? artifact.mimeType?.split('/')[1]?.toUpperCase();

export const isImageArtifact = (artifact: GoalArtifactView) =>
  artifact.type === 'file' &&
  (artifact.mimeType?.startsWith('image/') ||
    ['gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extensionOf(artifact) ?? ''));

/** What kind of thing the row is, told by its icon before its title is read. */
export const deliverableIconOf = (artifact: GoalArtifactView) => {
  if (artifact.type === 'document') return FileText;
  if (artifact.type === 'external') return Link2;
  if (isImageArtifact(artifact)) return FileImage;
  const ext = extensionOf(artifact);
  if (['7z', 'gz', 'rar', 'tar', 'tgz', 'zip'].includes(ext ?? '')) return FileArchive;
  if (['csv', 'tsv', 'xls', 'xlsx'].includes(ext ?? '')) return FileSpreadsheet;
  return File;
};

/**
 * Whether acceptance evidence cites the deliverable: a filled check when it
 * backs at least one criterion (named in the tooltip), a dashed ring when no
 * evidence points at it. Both carry an accessible label — the icon alone is
 * not the message.
 */
export const CitationMark = ({ item }: { item: DeliverableItem }) => {
  const { t } = useTranslation('chat');
  const cited = item.citedBy.length > 0;
  const label = cited
    ? t('goalProcess.result.deliverables.cited', {
        criteria: item.citedBy.map((criterion) => criterion.title).join('；'),
      })
    : t('goalProcess.result.deliverables.uncited');

  return (
    <Tooltip title={label}>
      <span
        aria-label={label}
        data-cited={cited}
        data-testid={'goal-deliverable-citation'}
        role={'img'}
        style={{ display: 'inline-flex', flex: 'none' }}
      >
        <Icon
          color={cited ? cssVar.colorSuccess : cssVar.colorTextQuaternary}
          icon={cited ? CircleCheck : CircleDashed}
          size={16}
        />
      </span>
    </Tooltip>
  );
};

export const deliverableTitleOf = (artifact: GoalArtifactView, untitled: string) =>
  artifact.title || artifact.identifier || untitled;
