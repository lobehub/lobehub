import { describe, expect, it } from 'vitest';

import type {
  AddIdentityMemoryParams,
  RemoveIdentityMemoryParams,
  UpdateIdentityMemoryParams,
} from '../../types';
import {
  getIdentityMemoryViewModel,
  getRemoveIdentityViewModel,
  getUpdateIdentityViewModel,
} from './identityMemoryViewModel';

const asAdd = (value: unknown) => value as AddIdentityMemoryParams;
const asUpdate = (value: unknown) => value as UpdateIdentityMemoryParams;
const asRemove = (value: unknown) => value as RemoveIdentityMemoryParams;

describe('getIdentityMemoryViewModel', () => {
  it('derives the card content from a well-formed tool call', () => {
    const vm = getIdentityMemoryViewModel(
      asAdd({
        details: 'Mentioned while discussing infra work',
        summary: 'Maintains LobeHub',
        tags: ['open-source'],
        title: 'Trusted open-source maintainer',
        withIdentity: {
          description: 'Maintains the LobeHub monorepo and reviews most infra PRs.',
          episodicDate: '2026-08-03T10:00:00Z',
          extractedLabels: ['maintainer'],
          relationship: 'self',
          role: 'platform engineer',
          scoreConfidence: 0.9,
          sourceEvidence: 'I maintain LobeHub.',
          type: 'professional',
        },
      }),
    );

    expect(vm).toMatchObject({
      confidence: 90,
      description: 'Maintains the LobeHub monorepo and reviews most infra PRs.',
      episodicDate: '2026-08-03',
      hasIdentityContent: true,
      identityType: 'professional',
      isEmpty: false,
      labels: ['maintainer'],
      relationship: 'self',
      role: 'platform engineer',
      sourceEvidence: 'I maintain LobeHub.',
      tags: ['open-source'],
    });
  });

  it('keeps an unparseable episodic date instead of rendering Invalid Date', () => {
    const vm = getIdentityMemoryViewModel(
      asAdd({ withIdentity: { episodicDate: 'sometime last year' } }),
    );

    expect(vm.episodicDate).toBe('sometime last year');
  });

  it('normalizes scalars sent where arrays are expected', () => {
    const vm = getIdentityMemoryViewModel(
      asAdd({
        summary: 'Summary only',
        tags: 'open-source',
        withIdentity: { description: 'Still renders.', extractedLabels: 'maintainer' },
      }),
    );

    expect(vm.tags).toEqual([]);
    expect(vm.labels).toEqual([]);
    expect(vm.hasIdentityContent).toBe(true);
  });

  it('reports an empty view model while arguments are still streaming', () => {
    expect(getIdentityMemoryViewModel(asAdd({})).isEmpty).toBe(true);
    expect(getIdentityMemoryViewModel(undefined).isEmpty).toBe(true);
    expect(getIdentityMemoryViewModel(asAdd({ title: 'Maintainer' })).isEmpty).toBe(false);
  });
});

describe('getUpdateIdentityViewModel', () => {
  it('names only the fields the update actually writes, in display order', () => {
    const vm = getUpdateIdentityViewModel(
      asUpdate({
        id: 'identity-1',
        mergeStrategy: 'merge',
        set: {
          details: null,
          memoryCategory: null,
          summary: null,
          tags: null,
          title: 'Principal engineer',
          withIdentity: {
            description: 'Now leads the platform team.',
            episodicDate: null,
            extractedLabels: null,
            relationship: null,
            role: 'principal engineer',
            scoreConfidence: null,
            sourceEvidence: null,
            type: null,
          },
        },
      }),
    );

    expect(vm.changedFields).toEqual(['Title', 'Description', 'Role']);
    expect(vm.id).toBe('identity-1');
    expect(vm.mergeStrategy).toBe('merge');
    expect(vm.identity.title).toBe('Principal engineer');
    expect(vm.isEmpty).toBe(false);
  });

  it('treats an emptied array as untouched rather than a change', () => {
    const vm = getUpdateIdentityViewModel(
      asUpdate({ id: 'identity-1', set: { tags: [], withIdentity: { extractedLabels: [] } } }),
    );

    expect(vm.changedFields).toEqual([]);
  });

  it('counts a zero confidence as a real change', () => {
    const vm = getUpdateIdentityViewModel(
      asUpdate({ id: 'identity-1', set: { withIdentity: { scoreConfidence: 0 } } }),
    );

    expect(vm.changedFields).toEqual(['Confidence']);
    expect(vm.identity.confidence).toBe(0);
  });

  it('is empty only when there is no id and nothing was written', () => {
    expect(getUpdateIdentityViewModel(asUpdate({})).isEmpty).toBe(true);
    expect(getUpdateIdentityViewModel(undefined).isEmpty).toBe(true);
    expect(getUpdateIdentityViewModel(asUpdate({ id: 'identity-1' })).isEmpty).toBe(false);
  });
});

describe('getRemoveIdentityViewModel', () => {
  it('surfaces the id and the reason', () => {
    const vm = getRemoveIdentityViewModel(
      asRemove({ id: 'identity-1', reason: 'Superseded by a newer role.' }),
    );

    expect(vm).toEqual({
      id: 'identity-1',
      isEmpty: false,
      reason: 'Superseded by a newer role.',
    });
  });

  it('reports an empty view model while arguments are still streaming', () => {
    expect(getRemoveIdentityViewModel(asRemove({})).isEmpty).toBe(true);
    expect(getRemoveIdentityViewModel(undefined).isEmpty).toBe(true);
  });
});
