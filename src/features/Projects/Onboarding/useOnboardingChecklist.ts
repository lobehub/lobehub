import { useFetchWorkspaceMembers } from '@/business/client/hooks/useFetchWorkspaceMembers';
import { useGoalStore } from '@/store/goal';
import { goalListScopeId } from '@/store/goal/projection';
import { goalSelectors } from '@/store/goal/selectors';
import type { ProjectDetail } from '@/store/project';
import { useProjectDirectories, useProjectDirectoryStore } from '@/store/projectWorkingDirectory';

import { useProjectSites } from '../Review/useProjectReview';
import { toMemberSource, toOnboardingFacts } from './facts';
import { getOnboardingChecklist } from './steps';

const SITE_DETECTION_REFRESH_MS = 10_000;

export const useOnboardingChecklist = (detail: ProjectDetail, waitingForScript: boolean) => {
  const { project } = detail;

  const sites = useProjectSites(project.id, {
    refreshInterval: waitingForScript ? SITE_DETECTION_REFRESH_MS : 0,
  });
  const directoriesRequest = useProjectDirectoryStore((s) => s.useFetchDirectories)(project.id);
  const directories = useProjectDirectories(project.id);
  const topicsRequest = useProjectDirectoryStore((s) => s.useFetchProjectTopics)(project.id);
  const topics = useProjectDirectoryStore((s) => s.projectTopicsMap[project.id]);
  const goalsRequest = useGoalStore((s) => s.useFetchGoals)(undefined, project.id);
  const goals = useGoalStore(
    goalSelectors.goalListView(goalListScopeId({ projectId: project.id })),
  );
  const members = useFetchWorkspaceMembers();

  const checklist = getOnboardingChecklist(
    { inWorkspace: Boolean(project.workspaceId) },
    toOnboardingFacts({
      directories: {
        error: directoriesRequest.error,
        rows: directoriesRequest.hasData ? directories : undefined,
      },
      goals: { error: goalsRequest.error, rows: goals?.goals },
      knowledgeBaseCount: detail.knowledgeBases?.length ?? 0,
      members: toMemberSource(members),
      sites: { error: sites.error, rows: sites.data },
      tasks: detail.tasks ?? undefined,
      topics: { error: topicsRequest.error, rows: topicsRequest.hasData ? topics : undefined },
    }),
  );

  return { checklist, refreshSites: () => sites.mutate(), sites: sites.data ?? [] };
};
