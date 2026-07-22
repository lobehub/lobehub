import type { OnboardingUnderstandingPollingResult, UnderstandingAnalysis } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  isUnderstandingDone,
  isUnderstandingFailed,
  mapUnderstandingToAnalysisStatus,
  mapUnderstandingToProfile,
} from './mapping';

const analysis: UnderstandingAnalysis = {
  composition: {
    identities: [
      {
        description: 'Designs and ships editor products.',
        salience: 90,
        title: 'Designer-engineer',
      },
    ],
    interests: [
      { description: 'Keeps up with AIGC research.', salience: 80, title: 'AIGC research' },
      { description: 'Enjoys typography.', salience: 40, title: 'Typography' },
    ],
    lifeStyle: [],
    social: [],
    working: [
      { description: 'Maintains open-source projects.', salience: 70, title: 'Open source' },
    ],
  },
  personaProposal: {
    content: 'persona content',
    reasoning: 'reasoning',
    tagline: 'persona tagline',
  },
  profile: {
    description: 'A long-form identity paragraph.',
    domains: ['design'],
    name: 'Canis Minor',
    pronoun: 'they/them',
    roles: ['designer'],
    summary: 'Ships prototypes to polish with rigor.',
    tagline: 'Pragmatic designer-engineer',
  },
};

const sourceRun = (status: string, id = 'source-1') =>
  ({
    source: { externalAccountId: 'acc', id, provider: 'github' },
    status,
    threadId: `thread-${id}`,
  }) as OnboardingUnderstandingPollingResult['runs'][number];

const baseResult = (
  overrides: Partial<OnboardingUnderstandingPollingResult>,
): OnboardingUnderstandingPollingResult => ({
  id: 'session-1',
  runs: [],
  status: 'processing',
  ...overrides,
});

describe('mapUnderstandingToAnalysisStatus', () => {
  it('returns undefined without a polling result', () => {
    expect(mapUnderstandingToAnalysisStatus(undefined)).toBeUndefined();
  });

  it('marks review running while sources are still collecting', () => {
    const status = mapUnderstandingToAnalysisStatus(
      baseResult({ runs: [sourceRun('collecting'), sourceRun('pending', 'source-2')] }),
    );

    expect(status?.items).toEqual([
      { id: 'review', status: 'running' },
      { id: 'build', status: 'pending' },
      { id: 'explore', status: 'pending' },
    ]);
    expect(status?.done).toBe(false);
  });

  it('marks build running once analysis starts and review done', () => {
    const status = mapUnderstandingToAnalysisStatus(
      baseResult({ runs: [sourceRun('analyzing'), sourceRun('completed', 'source-2')] }),
    );

    expect(status?.items).toEqual([
      { id: 'review', status: 'done' },
      { id: 'build', status: 'running' },
      { id: 'explore', status: 'pending' },
    ]);
  });

  it('marks explore running while merging', () => {
    const status = mapUnderstandingToAnalysisStatus(
      baseResult({
        mergeRun: {
          inputThreadIds: ['thread-source-1'],
          status: 'processing',
          threadId: 'merge-thread',
        },
        runs: [sourceRun('completed')],
        status: 'merging',
      }),
    );

    expect(status?.items).toEqual([
      { id: 'review', status: 'done' },
      { id: 'build', status: 'running' },
      { id: 'explore', status: 'running' },
    ]);
  });

  it('completes every item when the session is done and surfaces salience-ranked facts', () => {
    const status = mapUnderstandingToAnalysisStatus(
      baseResult({
        displayResult: {
          kind: 'merged',
          result: {
            analysis,
            diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
            inputThreadIds: ['thread-source-1'],
            kind: 'merged',
            resultId: 'result-1',
          },
        },
        runs: [sourceRun('completed')],
        status: 'completed',
      }),
    );

    expect(status?.done).toBe(true);
    expect(status?.items.every((item) => item.status === 'done')).toBe(true);
    expect(status?.facts.map((fact) => fact.label)).toEqual([
      'Designer-engineer',
      'AIGC research',
      'Open source',
      'Typography',
    ]);
  });
});

describe('mapUnderstandingToProfile', () => {
  it('returns undefined before any analysis is available', () => {
    expect(mapUnderstandingToProfile(baseResult({}))).toBeUndefined();
  });

  it('maps the analysis profile onto the view model', () => {
    const profile = mapUnderstandingToProfile(
      baseResult({
        displayResult: {
          kind: 'provisional',
          result: {
            analysis,
            diagnostics: { errors: [], evidenceCount: 1, failedCount: 0, succeededCount: 1 },
            kind: 'source',
            resultId: 'result-1',
            source: { externalAccountId: 'acc', id: 'source-1', provider: 'github' },
          },
        },
      }),
    );

    expect(profile).toEqual({
      identity: ['A long-form identity paragraph.'],
      name: 'Canis Minor',
      subtitle: 'Pragmatic designer-engineer',
      tagline: 'Ships prototypes to polish with rigor.',
    });
  });
});

describe('status predicates', () => {
  it('treats completed and partial as done', () => {
    expect(isUnderstandingDone(baseResult({ status: 'completed' }))).toBe(true);
    expect(isUnderstandingDone(baseResult({ status: 'partial' }))).toBe(true);
    expect(isUnderstandingDone(baseResult({ status: 'merging' }))).toBe(false);
    expect(isUnderstandingDone(undefined)).toBe(false);
  });

  it('flags failed sessions', () => {
    expect(isUnderstandingFailed(baseResult({ status: 'failed' }))).toBe(true);
    expect(isUnderstandingFailed(baseResult({ status: 'processing' }))).toBe(false);
  });
});
