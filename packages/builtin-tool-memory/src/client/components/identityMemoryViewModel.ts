import dayjs from 'dayjs';

import type {
  AddIdentityMemoryParams,
  RemoveIdentityMemoryParams,
  UpdateIdentityMemoryParams,
} from '../../types';
import { asText, asTextList, toPercent } from './memoryArgs';

export interface IdentityMemoryViewModel {
  confidence?: number;
  description?: string;
  details?: string;
  /** When the identity fact was observed, formatted when parseable. */
  episodicDate?: string;
  /** Whether the identity-specific layer has anything worth its own sections. */
  hasIdentityContent: boolean;
  identityType?: string;
  /** Nothing to show at all — the card renders nothing in this case. */
  isEmpty: boolean;
  labels: string[];
  relationship?: string;
  role?: string;
  /** The quote the model leaned on; shown so a wrong inference is easy to spot. */
  sourceEvidence?: string;
  summary?: string;
  tags: string[];
  title?: string;
}

/** The `set` payload of an update has the same shape as an add, only nullable. */
type IdentityPayload = AddIdentityMemoryParams | UpdateIdentityMemoryParams['set'] | undefined;

const formatEpisodicDate = (value: unknown) => {
  const text = asText(value);
  if (!text) return undefined;

  const moment = dayjs(text);
  // Models emit free-form dates here often enough that an unparseable value has to
  // survive as-is rather than render "Invalid Date".
  return moment.isValid() ? moment.format('YYYY-MM-DD') : text;
};

/**
 * Derive everything an identity card renders, from either an add or the `set` half
 * of an update. See {@link asText} for why every field is treated as untrusted.
 */
export const getIdentityMemoryViewModel = (data?: IdentityPayload): IdentityMemoryViewModel => {
  const { summary, details, tags, title, withIdentity } = data || {};
  const {
    description,
    episodicDate,
    extractedLabels,
    relationship,
    role,
    scoreConfidence,
    sourceEvidence,
    type,
  } = withIdentity || {};

  const safeDescription = asText(description);
  const safeRole = asText(role);
  const safeEvidence = asText(sourceEvidence);
  const safeEpisodicDate = formatEpisodicDate(episodicDate);
  const confidence = toPercent(scoreConfidence);
  const safeTags = asTextList(tags);
  const safeSummary = asText(summary);
  const safeDetails = asText(details);
  const safeTitle = asText(title);

  const hasIdentityContent =
    !!safeDescription ||
    !!safeRole ||
    !!safeEvidence ||
    !!safeEpisodicDate ||
    confidence !== undefined;

  return {
    confidence,
    description: safeDescription,
    details: safeDetails,
    episodicDate: safeEpisodicDate,
    hasIdentityContent,
    identityType: asText(type),
    isEmpty: !safeSummary && !safeDetails && !safeTags.length && !safeTitle && !hasIdentityContent,
    labels: asTextList(extractedLabels),
    relationship: asText(relationship),
    role: safeRole,
    sourceEvidence: safeEvidence,
    summary: safeSummary,
    tags: safeTags,
    title: safeTitle,
  };
};

export interface UpdateIdentityViewModel {
  /** Labels of the fields this update actually writes, in display order. */
  changedFields: string[];
  id?: string;
  identity: IdentityMemoryViewModel;
  /** Nothing to show at all — the card renders nothing in this case. */
  isEmpty: boolean;
  mergeStrategy?: string;
}

/** Ordered so the changed-field summary reads top-down like the card does. */
const UPDATE_FIELD_LABELS: [key: string, label: string][] = [
  ['title', 'Title'],
  ['summary', 'Summary'],
  ['details', 'Details'],
  ['tags', 'Tags'],
  ['memoryCategory', 'Category'],
];

const UPDATE_IDENTITY_FIELD_LABELS: [key: string, label: string][] = [
  ['description', 'Description'],
  ['role', 'Role'],
  ['relationship', 'Relationship'],
  ['type', 'Type'],
  ['extractedLabels', 'Labels'],
  ['scoreConfidence', 'Confidence'],
  ['sourceEvidence', 'Evidence'],
  ['episodicDate', 'Date'],
];

/**
 * An update sends every field and nulls the ones it does not touch, so the useful
 * signal is which keys carry a value — that is what the card leads with.
 */
const isWritten = (value: unknown) =>
  value !== null && value !== undefined && (!Array.isArray(value) || value.length > 0);

export const getUpdateIdentityViewModel = (
  data?: UpdateIdentityMemoryParams,
): UpdateIdentityViewModel => {
  const set = data?.set;
  const identity = getIdentityMemoryViewModel(set);

  const changedFields = [
    ...UPDATE_FIELD_LABELS.filter(([key]) => isWritten((set as Record<string, unknown>)?.[key])),
    ...UPDATE_IDENTITY_FIELD_LABELS.filter(([key]) =>
      isWritten((set?.withIdentity as Record<string, unknown> | undefined)?.[key]),
    ),
  ].map(([, label]) => label);

  return {
    changedFields,
    id: asText(data?.id),
    identity,
    isEmpty: identity.isEmpty && changedFields.length === 0 && !asText(data?.id),
    mergeStrategy: asText(data?.mergeStrategy),
  };
};

export interface RemoveIdentityViewModel {
  id?: string;
  isEmpty: boolean;
  reason?: string;
}

export const getRemoveIdentityViewModel = (
  data?: RemoveIdentityMemoryParams,
): RemoveIdentityViewModel => {
  const id = asText(data?.id);
  const reason = asText(data?.reason);

  return { id, isEmpty: !id && !reason, reason };
};
