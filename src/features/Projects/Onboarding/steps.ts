export type OnboardingBasicKey = 'firstChat' | 'importTasks' | 'inviteMembers';

export type OnboardingConnectKey = 'directory' | 'goal' | 'knowledge' | 'site';

export type SiteConnectState = 'none' | 'seen' | 'waiting';

export interface OnboardingFacts {
  directoryCount?: number;
  goalCount?: number;
  knowledgeBaseCount?: number;
  siteCount?: number;
  sitesSeen?: boolean;
  taskCount?: number;
  topicCount?: number;
  workspaceMemberCount?: number;
}

export interface OnboardingBasicStep {
  done: boolean;
  key: OnboardingBasicKey;
}

export interface OnboardingConnection {
  count: number;
  done: boolean;
  key: OnboardingConnectKey;
  site?: SiteConnectState;
}

export interface OnboardingChecklist {
  basics: OnboardingBasicStep[];
  completed: number;
  connect: OnboardingConnection[];
  loading: boolean;
  total: number;
}

const basicDone = (key: OnboardingBasicKey, facts: OnboardingFacts): boolean | undefined => {
  switch (key) {
    case 'importTasks': {
      return facts.taskCount === undefined ? undefined : facts.taskCount > 0;
    }
    case 'firstChat': {
      return facts.topicCount === undefined ? undefined : facts.topicCount > 0;
    }
    case 'inviteMembers': {
      return facts.workspaceMemberCount === undefined ? undefined : facts.workspaceMemberCount > 1;
    }
  }
};

const siteState = ({ siteCount = 0, sitesSeen }: OnboardingFacts): SiteConnectState =>
  sitesSeen ? 'seen' : siteCount > 0 ? 'waiting' : 'none';

const connection = (
  key: Exclude<OnboardingConnectKey, 'site'>,
  count = 0,
): OnboardingConnection => ({
  count,
  done: count > 0,
  key,
});

export const getOnboardingChecklist = (
  { inWorkspace }: { inWorkspace: boolean },
  facts: OnboardingFacts,
): OnboardingChecklist => {
  const keys: OnboardingBasicKey[] = inWorkspace
    ? ['importTasks', 'firstChat', 'inviteMembers']
    : ['importTasks', 'firstChat'];
  const resolved = keys.map((key) => ({ done: basicDone(key, facts), key }));
  const basics = resolved.map(({ done, key }) => ({ done: done === true, key }));
  const site = siteState(facts);

  return {
    basics,
    completed: basics.filter((step) => step.done).length,
    connect: [
      connection('directory', facts.directoryCount),
      { count: facts.siteCount ?? 0, done: site === 'seen', key: 'site', site },
      connection('knowledge', facts.knowledgeBaseCount),
      connection('goal', facts.goalCount),
    ],
    loading: resolved.some((step) => step.done === undefined),
    total: basics.length,
  };
};

export const toFactCount = (rows: readonly unknown[] | undefined, error: unknown) =>
  rows ? rows.length : error ? 0 : undefined;

// Hidden while loading instead of a skeleton: a finished project would otherwise flash a placeholder on every visit.
export const getOnboardingCardVisible = (
  checklist: OnboardingChecklist,
  { canManage, dismissed }: { canManage: boolean; dismissed: boolean },
) => canManage && !dismissed && !checklist.loading && checklist.completed < checklist.total;
