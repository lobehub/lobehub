import type { OnboardingFacts } from './steps';
import { toFactCount } from './steps';

interface Source<T> {
  error: unknown;
  rows: readonly T[] | undefined;
}

interface OnboardingSources {
  directories: Source<unknown>;
  goals: Source<unknown>;
  knowledgeBaseCount: number;
  members: Source<unknown>;
  sites: Source<{ lastSeenAt?: unknown }>;
  tasks: readonly unknown[] | undefined;
  topics: Source<unknown>;
}

const count = ({ error, rows }: Source<unknown>) => toFactCount(rows, error);

export const toOnboardingFacts = (sources: OnboardingSources): OnboardingFacts => ({
  directoryCount: count(sources.directories),
  goalCount: count(sources.goals),
  knowledgeBaseCount: sources.knowledgeBaseCount,
  siteCount: count(sources.sites),
  sitesSeen: sources.sites.rows
    ? sources.sites.rows.some((site) => Boolean(site.lastSeenAt))
    : sources.sites.error
      ? false
      : undefined,
  taskCount: sources.tasks?.length ?? 0,
  topicCount: count(sources.topics),
  workspaceMemberCount: count(sources.members),
});

export const toMemberSource = ({
  data,
  isLoading,
}: {
  data?: readonly unknown[];
  isLoading: boolean;
}): Source<unknown> => ({ error: undefined, rows: isLoading ? undefined : (data ?? []) });
