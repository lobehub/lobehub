import type {
  OnDemandContextCandidate,
  OnDemandDynamicEntry,
  OnDemandDynamicKind,
  OnDemandRetrievalAuthority,
  OnDemandRetrievalBatch,
  OnDemandRetrievalDrop,
  OnDemandRetrievalMode,
  OnDemandRetrievalResult,
  OnDemandRetrievalScope,
} from '@lobechat/types';
import {
  ON_DEMAND_RETRIEVAL_AUTHORITIES,
  ON_DEMAND_RETRIEVAL_AUTHORITY_RANK,
} from '@lobechat/types';
import { estimateTokenCount } from 'tokenx';

import { hashContent } from '../canonical';

const MIN_RELEVANCE = 0.2;
const MAX_ENTRY_CHARS = 720;
const MAX_LEXICAL_EXCERPT_FRAGMENTS = 6;

const AUTHORITY_PRIORITY: Readonly<Record<OnDemandRetrievalAuthority, number>> = Object.freeze({
  approved_experience: 700,
  explicit_constraint: 1_000,
  memory: 600,
  stable_preference: 900,
  unapproved_suggestion: 100,
});

const AUTHORITY_KIND: Readonly<Record<OnDemandRetrievalAuthority, OnDemandDynamicKind>> =
  Object.freeze({
    approved_experience: 'approved_expertise',
    explicit_constraint: 'explicit_constraint',
    memory: 'memory',
    stable_preference: 'preference',
    unapproved_suggestion: 'unapproved_suggestion',
  });

const AUTHORITY_LABEL: Readonly<Record<OnDemandRetrievalAuthority, string>> = Object.freeze({
  approved_experience: 'agent_experience',
  explicit_constraint: 'user_constraint',
  memory: 'retrieved_memory',
  stable_preference: 'user_preference',
  unapproved_suggestion: 'agent_suggestion',
});

const normalize = (value: string) => value.toLocaleLowerCase();

const escapeXmlAttr = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

const escapeXmlContent = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const queryTerms = (message: string): string[] => {
  const normalized = normalize(message);
  const latinTerms = normalized.match(/[a-z0-9][a-z0-9_-]+/g) ?? [];
  const cjkTerms = normalized.match(/\p{Script=Han}{2,}/gu) ?? [];
  const bigrams = cjkTerms.flatMap((term) =>
    [...term].length <= 2
      ? [term]
      : [...term].map((char, index) => [...term].slice(index, index + 2).join('')),
  );

  return [...new Set([...latinTerms, ...cjkTerms, ...bigrams])];
};

/**
 * Deterministic lexical relevance used when an embedding provider fails or a
 * client-side caller has only cached memory rows.
 */
export const scoreLexicalRelevance = (query: string, content: string): number => {
  const terms = queryTerms(query);
  if (terms.length === 0 || !content.trim()) return 0;

  const normalizedContent = normalize(content);
  const matches = terms.filter((term) => normalizedContent.includes(term)).length;
  const coverage = matches / terms.length;
  const exactPhraseBonus = normalizedContent.includes(normalize(query).trim()) ? 0.2 : 0;

  return Math.min(1, coverage * 0.8 + exactPhraseBonus);
};

const splitFragments = (content: string): string[] =>
  content
    .split(/\n{2,}|(?<=[.!?。！？])\s+|\n(?=[-*] |#{2,4} )/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);

const compactRelevantContent = (query: string, content: string): string => {
  const normalized = content.trim();
  if (normalized.length <= MAX_ENTRY_CHARS) return normalized;

  const ranked = splitFragments(normalized)
    .map((fragment, index) => ({
      fragment,
      index,
      score: scoreLexicalRelevance(query, fragment),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_LEXICAL_EXCERPT_FRAGMENTS);

  const selected: string[] = [];
  let length = 0;
  for (const item of ranked) {
    if (selected.length > 0 && length + item.fragment.length > MAX_ENTRY_CHARS) continue;
    selected.push(item.fragment);
    length += item.fragment.length + 1;
    if (length >= MAX_ENTRY_CHARS) break;
  }

  return `${selected.join('\n')}\n[relevance excerpt]`;
};

/**
 * Persona is a document, not a preference row. Only headings/sections whose
 * own text matches this turn are returned; an unrelated persona contributes
 * nothing rather than being injected in full.
 */
export const selectRelevantPersonaFragments = (
  persona: string | null | undefined,
  query: string,
  maxFragments = 3,
): string[] => {
  if (!persona?.trim()) return [];

  const sections = persona
    .split(/\n(?=#{2,4} )/)
    .map((section) => section.trim())
    .filter(Boolean);
  const candidates =
    sections.length > 1
      ? sections
      : splitFragments(persona).filter((fragment) => /^[-*] |^#{2,4} /.test(fragment));

  return candidates
    .map((fragment, index) => ({
      fragment,
      index,
      score: scoreLexicalRelevance(query, fragment),
    }))
    .filter((item) => item.score >= MIN_RELEVANCE)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, maxFragments)
    .map((item) => compactRelevantContent(query, item.fragment));
};

const isScopeVisible = (
  candidate: OnDemandContextCandidate,
  scope?: OnDemandRetrievalScope,
): boolean => {
  if (candidate.scope.shareGate !== 'allowed') return false;
  if (!scope) return true;

  switch (candidate.scope.share) {
    case 'agent': {
      return (
        !!scope.agentId &&
        candidate.scope.agentId === scope.agentId &&
        (!candidate.scope.workspaceId || candidate.scope.workspaceId === scope.workspaceId)
      );
    }
    case 'personal': {
      return candidate.scope.ownerUserId === scope.userId;
    }
    case 'public': {
      return true;
    }
    case 'workspace': {
      return !!scope.workspaceId && candidate.scope.workspaceId === scope.workspaceId;
    }
  }
};

const resolveApprovalState = (
  candidate: OnDemandContextCandidate,
): OnDemandContextCandidate['approval']['state'] => {
  if (
    candidate.approval.state === 'approved' &&
    candidate.approval.approvedContentHash &&
    candidate.approval.approvedContentHash !== candidate.contentHash
  ) {
    return 'hash_mismatch';
  }

  return candidate.approval.state;
};

const downgradeUnapprovedAuthority = (
  authority: OnDemandRetrievalAuthority,
  approvalState: OnDemandContextCandidate['approval']['state'],
): OnDemandRetrievalAuthority =>
  approvalState === 'approved' ? authority : 'unapproved_suggestion';

const compareCandidates = (
  a: { candidate: OnDemandContextCandidate; lexical: number; relevance: number },
  b: { candidate: OnDemandContextCandidate; lexical: number; relevance: number },
): number => {
  const authorityDelta =
    ON_DEMAND_RETRIEVAL_AUTHORITY_RANK[b.candidate.authority] -
    ON_DEMAND_RETRIEVAL_AUTHORITY_RANK[a.candidate.authority];
  if (authorityDelta !== 0) return authorityDelta;

  const relevanceDelta = b.relevance - a.relevance;
  if (relevanceDelta !== 0) return relevanceDelta;

  const lexicalDelta = b.lexical - a.lexical;
  if (lexicalDelta !== 0) return lexicalDelta;

  const sourceDelta = `${a.candidate.source.type}:${a.candidate.source.id}`.localeCompare(
    `${b.candidate.source.type}:${b.candidate.source.id}`,
  );
  if (sourceDelta !== 0) return sourceDelta;

  const hashDelta = a.candidate.contentHash.localeCompare(b.candidate.contentHash);
  if (hashDelta !== 0) return hashDelta;

  return a.candidate.id.localeCompare(b.candidate.id);
};

const renderEntryContent = (
  candidate: OnDemandContextCandidate,
  authority: OnDemandRetrievalAuthority,
  approvalState: OnDemandContextCandidate['approval']['state'],
  content: string,
): string => {
  const label = AUTHORITY_LABEL[authority];
  const status =
    authority === 'unapproved_suggestion'
      ? `status="${escapeXmlAttr(approvalState === 'approved' ? 'unapproved' : approvalState)}"`
      : authority === 'approved_experience'
        ? 'status="approved"'
        : authority === 'explicit_constraint'
          ? 'precedence="explicit"'
          : '';

  return [
    `<${label} source="${escapeXmlAttr(
      `${candidate.source.type}:${candidate.source.id}`,
    )}"${status ? ` ${status}` : ''}>`,
    escapeXmlContent(content),
    `</${label}>`,
  ].join('\n');
};

/**
 * Shared deterministic retrieval/ranking entry point for client and server
 * context assembly. Storage adapters provide candidate facts; this function
 * owns scope gating, relevance fallback, authority precedence, conflict
 * resolution, approval downgrade, compression, and provenance.
 */
export const retrieveOnDemandContext = (input: {
  batch?: OnDemandRetrievalBatch;
  currentUserMessage: string;
  scope?: OnDemandRetrievalScope;
}): OnDemandRetrievalResult => {
  const startedAt = performance.now();
  const candidates = input.batch?.candidates ?? [];
  const dropped: OnDemandRetrievalDrop[] = [];
  const normalized: Array<{
    authority: OnDemandRetrievalAuthority;
    candidate: OnDemandContextCandidate;
    content: string;
    lexical: number;
    relevance: number;
  }> = [];

  for (const candidate of candidates) {
    if (!isScopeVisible(candidate, input.scope)) {
      dropped.push({ candidate, reason: 'scope_denied' });
      continue;
    }

    const approvalState = resolveApprovalState(candidate);
    const authority = downgradeUnapprovedAuthority(candidate.authority, approvalState);
    const content = compactRelevantContent(input.currentUserMessage, candidate.content);
    if (!content) {
      dropped.push({ candidate, reason: 'empty' });
      continue;
    }

    const lexical = scoreLexicalRelevance(input.currentUserMessage, content);
    const relevance = Math.max(lexical, Math.min(1, Math.max(0, candidate.relevance ?? 0)));
    if (authority !== 'explicit_constraint' && relevance < MIN_RELEVANCE) {
      dropped.push({ candidate, reason: 'not_relevant' });
      continue;
    }

    normalized.push({
      authority,
      candidate: { ...candidate, authority },
      content,
      lexical,
      relevance,
    });
  }

  normalized.sort(compareCandidates);

  const conflictWinners = new Set<string>();
  const entries: OnDemandDynamicEntry[] = [];
  for (const item of normalized) {
    const { authority, candidate, content, relevance } = item;
    if (candidate.conflictKey) {
      if (conflictWinners.has(candidate.conflictKey)) {
        dropped.push({ candidate, reason: 'higher_priority_conflict' });
        continue;
      }
      conflictWinners.add(candidate.conflictKey);
    }

    const approvalState = resolveApprovalState(candidate);
    const rendered = renderEntryContent(candidate, authority, approvalState, content);
    const kind = AUTHORITY_KIND[authority];

    entries.push(
      Object.freeze({
        content: rendered,
        estimatedTokens: estimateTokenCount(rendered),
        key: `retrieval:${kind}:${candidate.id}`,
        kind,
        priority: AUTHORITY_PRIORITY[authority],
        provenance: Object.freeze({
          contentHash: hashContent(rendered),
          source: candidate.source,
          ...(candidate.sourceVersion && { sourceVersion: candidate.sourceVersion }),
        }),
        relevance,
        required: authority === 'explicit_constraint',
        source: candidate.source,
      }),
    );
  }

  const mode: OnDemandRetrievalMode =
    input.batch?.mode ??
    (candidates.some((candidate) => candidate.relevance !== undefined)
      ? 'vector'
      : candidates.length > 0
        ? 'lexical_fallback'
        : 'none');
  const provenance = candidates
    .map((candidate) => ({
      approval: candidate.approval.state,
      authority: candidate.authority,
      contentHash: candidate.contentHash,
      id: candidate.id,
      source: `${candidate.source.type}:${candidate.source.id}`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const durationMs = Math.max(0, input.batch?.durationMs ?? 0) + performance.now() - startedAt;

  return Object.freeze({
    dropped: Object.freeze(dropped),
    entries: Object.freeze(entries),
    metadata: Object.freeze({
      durationMs: Math.round(durationMs * 100) / 100,
      hitCount: entries.length,
      mode,
      provenanceHash: hashContent(provenance),
      queryHash: hashContent(input.currentUserMessage),
    }),
  });
};

// Guard the ranking vocabulary against a type-only refactor silently changing
// the documented authority list.
if (ON_DEMAND_RETRIEVAL_AUTHORITIES.length !== Object.keys(AUTHORITY_PRIORITY).length) {
  throw new Error('Every retrieval authority must define one priority.');
}
