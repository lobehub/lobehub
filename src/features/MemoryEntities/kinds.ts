import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  CalendarDaysIcon,
  FolderKanbanIcon,
  type LucideIcon,
  ShapesIcon,
  TargetIcon,
  UsersRoundIcon,
} from 'lucide-react';

import { type ContextKind, type EntityStatus } from './types';

interface KindMeta {
  icon: LucideIcon;
}

/** List order: what the user is driving first, then who and what happens around it. */
export const CONTEXT_KINDS: ContextKind[] = ['project', 'goal', 'relationship', 'event', 'other'];

export const KIND_META: Record<ContextKind, KindMeta> = {
  event: { icon: CalendarDaysIcon },
  goal: { icon: TargetIcon },
  other: { icon: ShapesIcon },
  project: { icon: FolderKanbanIcon },
  relationship: { icon: UsersRoundIcon },
};

/**
 * The extractor writes `type` as free text: project (34%), relationship, other, goal and event
 * cover ~76% of rows, the rest is a long tail. Map the tail onto the nearest kind by word.
 */
const KIND_BY_TYPE: Record<string, ContextKind> = {
  activity: 'event',
  crisis: 'event',
  creative_project: 'project',
  event: 'event',
  goal: 'goal',
  incident: 'event',
  infrastructure: 'project',
  people: 'relationship',
  person: 'relationship',
  plan: 'project',
  process: 'project',
  project: 'project',
  relationship: 'relationship',
  research: 'project',
  social: 'relationship',
  strategy: 'goal',
  task: 'project',
  trip: 'event',
  work: 'project',
  workflow: 'project',
  workplace: 'project',
};

export const kindOfType = (type?: string | null): ContextKind => {
  const key = type
    ?.trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
  if (!key) return 'other';
  if (KIND_BY_TYPE[key]) return KIND_BY_TYPE[key];
  if (key.includes('project')) return 'project';
  if (key.includes('goal')) return 'goal';
  if (key.includes('relation') || key.includes('family') || key.includes('friend'))
    return 'relationship';
  if (key.includes('event') || key.includes('trip')) return 'event';
  return 'other';
};

/**
 * Backend `currentStatus` values with a translated label (`entity.status.*`); anything else is
 * shown as written. Older rows (before the status enum) say `active`.
 */
const LABELLED_STATUS = [
  'aborted',
  'active',
  'cancelled',
  'completed',
  'on_hold',
  'ongoing',
  'planned',
] as const;

export type LabelledStatus = (typeof LABELLED_STATUS)[number];

export const hasStatusLabel = (value: string): value is LabelledStatus =>
  (LABELLED_STATUS as readonly string[]).includes(value);

export const statusOfValue = (value?: string | null): EntityStatus => {
  switch (value) {
    case 'completed':
    case 'aborted':
    case 'cancelled': {
      return 'closed';
    }
    case 'on_hold': {
      return 'dormant';
    }
    default: {
      return 'active';
    }
  }
};

/**
 * One hue per kind, used only on the kind icon. Everything else on the page stays neutral,
 * so the colour reads as "which kind" and nothing more.
 */
export const kindTint = stylex.create({
  event: { backgroundColor: cssVar.orangeFillSecondary, color: cssVar.orange },
  goal: { backgroundColor: cssVar.greenFillSecondary, color: cssVar.green },
  other: { backgroundColor: cssVar.colorFillSecondary, color: cssVar.colorTextSecondary },
  project: { backgroundColor: cssVar.geekblueFillSecondary, color: cssVar.geekblue },
  relationship: { backgroundColor: cssVar.goldFillSecondary, color: cssVar.gold },
});
