import { useClientDataSWR } from '@/libs/swr';
import { swrKeys } from '@/libs/swr/keys';
import { expertiseService } from '@/services/expertise';

export const useExpertiseOverview = (agentId?: string) =>
  useClientDataSWR(agentId ? swrKeys.expertise.overview(agentId) : null, () =>
    expertiseService.listByAgent(agentId!),
  );

export const useExpertiseDomain = (domainId?: string) =>
  useClientDataSWR(domainId ? swrKeys.expertise.domain(domainId) : null, () =>
    expertiseService.getDomain(domainId!),
  );

export const useExpertiseLessons = (domainId?: string, layer?: string, search?: string) =>
  useClientDataSWR(domainId ? swrKeys.expertise.lessons(domainId, layer, search) : null, () =>
    expertiseService.listLessons({ domainId: domainId!, layer, search }),
  );

/** 到达 90% 渐近线所需的实践次数：P(n)=P∞(1−e^(−n/τ)) ⇒ n = τ·ln10。 */
export const runsToNinety = (tau: number) => Math.ceil(tau * Math.LN10);

/**
 * 把拟合参数展开成一条预测曲线。
 *
 * 只在 maturity.usable 时调用 —— 撞了 τ 上界或置信度不足的拟合画出来的曲线
 * 是边界伪影，比不画更有害。
 */
export const projectCurve = (pInf: number, tau: number, upto: number) =>
  Array.from({ length: upto }, (_, i) => ({
    n: i + 1,
    value: pInf * (1 - Math.exp(-(i + 1) / tau)),
  }));
