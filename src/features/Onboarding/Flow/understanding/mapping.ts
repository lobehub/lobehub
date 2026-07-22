import type {
  OnboardingAnalysisItemStatus,
  OnboardingAnalysisStatus,
  OnboardingProfileResult,
  OnboardingUnderstandingPollingResult,
  UnderstandingAnalysis,
  UnderstandingCompositionItem,
} from '@lobechat/types';

const MAX_FACTS = 6;

const COLLECTING_STATUSES = new Set(['pending', 'resolving', 'collecting']);
const TERMINAL_SOURCE_STATUSES = new Set(['completed', 'failed', 'stale']);

const pickAnalysis = (
  result: OnboardingUnderstandingPollingResult | undefined,
): UnderstandingAnalysis | undefined => result?.displayResult?.result.analysis;

const collectFacts = (analysis: UnderstandingAnalysis): OnboardingAnalysisStatus['facts'] => {
  const vectors: [string, UnderstandingCompositionItem[]][] = [
    ['identities', analysis.composition.identities],
    ['working', analysis.composition.working],
    ['interests', analysis.composition.interests],
    ['lifeStyle', analysis.composition.lifeStyle],
    ['social', analysis.composition.social],
  ];

  return vectors
    .flatMap(([vector, items]) =>
      items.map((item) => ({
        id: `${vector}:${item.title}`,
        label: item.title,
        salience: item.salience,
      })),
    )
    .sort((a, b) => b.salience - a.salience)
    .slice(0, MAX_FACTS)
    .map(({ id, label }) => ({ id, label }));
};

export const isUnderstandingDone = (
  result: OnboardingUnderstandingPollingResult | undefined,
): boolean => result?.status === 'completed' || result?.status === 'partial';

export const isUnderstandingFailed = (
  result: OnboardingUnderstandingPollingResult | undefined,
): boolean => result?.status === 'failed';

export const mapUnderstandingToAnalysisStatus = (
  result: OnboardingUnderstandingPollingResult | undefined,
): OnboardingAnalysisStatus | undefined => {
  if (!result) return undefined;

  const done = isUnderstandingDone(result);
  const runs = result.runs;
  const analysis = pickAnalysis(result);

  const anyCollecting = runs.some((run) => COLLECTING_STATUSES.has(run.status));
  const reviewDone =
    runs.length > 0 &&
    runs.every((run) => run.status === 'analyzing' || TERMINAL_SOURCE_STATUSES.has(run.status));

  const anyAnalyzing = runs.some((run) => run.status === 'analyzing');
  const merging = result.status === 'merging' || result.mergeRun?.status === 'processing';
  const mergeDone = result.mergeRun?.status === 'completed';

  const reviewStatus: OnboardingAnalysisItemStatus =
    done || reviewDone ? 'done' : anyCollecting ? 'running' : 'pending';
  const buildStatus: OnboardingAnalysisItemStatus =
    done || mergeDone ? 'done' : anyAnalyzing || merging ? 'running' : 'pending';
  const exploreStatus: OnboardingAnalysisItemStatus = done
    ? 'done'
    : merging
      ? 'running'
      : 'pending';

  return {
    done,
    facts: analysis ? collectFacts(analysis) : [],
    items: [
      { id: 'review', status: reviewStatus },
      { id: 'build', status: buildStatus },
      { id: 'explore', status: exploreStatus },
    ],
  };
};

export const mapUnderstandingToProfile = (
  result: OnboardingUnderstandingPollingResult | undefined,
): OnboardingProfileResult | undefined => {
  const analysis = pickAnalysis(result);
  if (!analysis) return undefined;

  const { description, name, summary, tagline } = analysis.profile;

  return { identity: [description], name, subtitle: tagline, tagline: summary };
};
