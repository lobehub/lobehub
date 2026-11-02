import type { OnDemandContextCandidate, OnDemandRetrievalAuthority } from '@lobechat/types';

import type { UserMemoryData } from '../../engine/messages/types';
import { hashContent } from '../canonical';
import { selectRelevantPersonaFragments } from './ranking';

const normalizeType = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';

const preferenceAuthority = (item: Record<string, unknown>): OnDemandRetrievalAuthority => {
  const metadata =
    item.metadata && typeof item.metadata === 'object'
      ? (item.metadata as Record<string, unknown>)
      : {};
  const kind = normalizeType(metadata.constraintKind ?? metadata.kind ?? item.type);

  return metadata.explicit === true ||
    ['constraint', 'explicit', 'instruction', 'rule'].includes(kind)
    ? 'explicit_constraint'
    : 'stable_preference';
};

const conflictKey = (item: Record<string, unknown>): string | undefined => {
  const metadata =
    item.metadata && typeof item.metadata === 'object'
      ? (item.metadata as Record<string, unknown>)
      : {};
  const value = metadata.conflictKey ?? metadata.constraintKey;

  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const candidate = (input: {
  authority: OnDemandRetrievalAuthority;
  content: string;
  id: string;
  item: Record<string, unknown>;
  type: 'memory' | 'user';
}): OnDemandContextCandidate | undefined => {
  const content = input.content.trim();
  if (!content) return undefined;

  const ownerUserId =
    typeof input.item.userId === 'string' ? (input.item.userId as string) : undefined;
  const updatedAt =
    typeof input.item.updatedAt === 'string' ? (input.item.updatedAt as string) : undefined;

  return Object.freeze({
    approval: { state: 'approved' as const },
    authority: input.authority,
    ...(conflictKey(input.item) && { conflictKey: conflictKey(input.item) }),
    content,
    contentHash: hashContent(content),
    id: input.id,
    scope: {
      ownerUserId,
      share: 'personal' as const,
      shareGate: 'allowed' as const,
    },
    source: { id: input.id, type: input.type },
    ...(updatedAt && { sourceVersion: updatedAt }),
  });
};

/**
 * Client-side candidate adapter. The server has a richer DB/vector retriever,
 * but both producers converge on `retrieveOnDemandContext`.
 */
export const buildOnDemandCandidatesFromUserMemory = (
  memories: UserMemoryData | undefined,
  currentUserMessage: string,
): OnDemandContextCandidate[] => {
  if (!memories) return [];

  const candidates: OnDemandContextCandidate[] = [];
  const push = (value: OnDemandContextCandidate | undefined) => {
    if (value) candidates.push(value);
  };

  for (const [index, raw] of (memories.preferences ?? []).entries()) {
    const item = raw as Record<string, unknown>;
    const content = typeof item.conclusionDirectives === 'string' ? item.conclusionDirectives : '';
    const id = typeof item.id === 'string' ? item.id : `preference-${index}`;
    push(
      candidate({
        authority: preferenceAuthority(item),
        content,
        id,
        item,
        type: 'memory',
      }),
    );
  }

  for (const [index, raw] of (memories.experiences ?? []).entries()) {
    const item = raw as Record<string, unknown>;
    const content = [item.situation, item.keyLearning].filter(Boolean).join('\n');
    const id = typeof item.id === 'string' ? item.id : `experience-${index}`;
    push(candidate({ authority: 'memory', content, id, item, type: 'memory' }));
  }

  for (const [index, raw] of (memories.contexts ?? []).entries()) {
    const item = raw as Record<string, unknown>;
    const content = [item.title, item.description].filter(Boolean).join('\n');
    const id = typeof item.id === 'string' ? item.id : `context-${index}`;
    push(candidate({ authority: 'memory', content, id, item, type: 'memory' }));
  }

  for (const [index, raw] of (memories.identities ?? []).entries()) {
    const item = raw as Record<string, unknown>;
    const content = [item.role, item.description].filter(Boolean).join('\n');
    const id = typeof item.id === 'string' ? item.id : `identity-${index}`;
    push(candidate({ authority: 'stable_preference', content, id, item, type: 'user' }));
  }

  const personaInstruction = [memories.persona?.tagline, memories.persona?.narrative]
    .filter(Boolean)
    .join('\n');
  for (const [index, fragment] of selectRelevantPersonaFragments(
    personaInstruction,
    currentUserMessage,
  ).entries()) {
    push(
      candidate({
        authority: 'stable_preference',
        content: fragment,
        id: `persona-${index}`,
        item: { userId: undefined },
        type: 'user',
      }),
    );
  }

  return candidates;
};
