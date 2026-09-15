import { useClientDataSWR } from '@/libs/swr';
import { swrKeys } from '@/libs/swr/keys';
import { expertiseService } from '@/services/expertise';

/**
 * The portrait query. `refreshInterval` is only set while a history warm-up is running so
 * newly learned habits stream in without a manual reload.
 */
export const useExpertiseOverview = (agentId?: string, refreshInterval?: number) =>
  useClientDataSWR(
    agentId ? swrKeys.expertise.overview(agentId) : null,
    () => expertiseService.listByAgent(agentId!),
    { refreshInterval },
  );

export const useExpertiseDomain = (domainId?: string) =>
  useClientDataSWR(domainId ? swrKeys.expertise.domain(domainId) : null, () =>
    expertiseService.getDomain(domainId!),
  );

export const useExpertiseLesson = (lessonId?: string) =>
  useClientDataSWR(lessonId ? swrKeys.expertise.lesson(lessonId) : null, () =>
    expertiseService.getLesson(lessonId!),
  );

export const useHistoryCount = (agentId?: string) =>
  useClientDataSWR(agentId ? swrKeys.expertise.historyCount(agentId) : null, () =>
    expertiseService.countHistory(agentId!),
  );
