import { useClientDataSWR } from '@/libs/swr';
import { swrKeys } from '@/libs/swr/keys';
import { type ExpertiseMaturity, expertiseService } from '@/services/expertise';

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

export const useExpertiseLesson = (lessonId?: string) =>
  useClientDataSWR(lessonId ? swrKeys.expertise.lesson(lessonId) : null, () =>
    expertiseService.getLesson(lessonId!),
  );

/** 到达渐近线某个比例所需的实践次数：P(n)=P∞(1−e^(−n/τ)) ⇒ n = −τ·ln(1−r)。 */
export const runsToRatio = (tau: number, ratio: number) => Math.ceil(-tau * Math.log(1 - ratio));

/**
 * 曲线形态 —— 图上那四条线的图例就是这四种。
 *
 * 刻意不只读 plateauKind：它描述拟合出的形状，而「掉头」是规则被退休的结果，
 * 在形状上仍然可能被拟合成 saturated。两者一起判断才对得上用户看见的那条线。
 */
export type ExpertiseShape = 'flat' | 'rising' | 'declining' | 'stuck' | 'fresh';

export const shapeOf = (
  maturity: ExpertiseMaturity,
  delta: number,
  runCount = 1,
): ExpertiseShape => {
  // 一次都没练过 ≠ 练了没学到。前者是还没开始，后者是花了力气没有产出 ——
  // 把刚建好的专长标成「练了没学到」，等于开局先给人判个不及格。
  if (runCount === 0) return 'fresh';
  if (delta < 0) return 'declining';
  if (maturity.usable && (maturity.maturity ?? 0) >= 0.9) return 'flat';
  if (delta === 0) return 'stuck';
  return 'rising';
};

/**
 * 把拟合参数展开成外推曲线。
 *
 * 起点接在今天的真实值上而不是模型值上 —— 否则外推段会从曲线末端跳一下，
 * 那个跳变会被读成「数据出错了」。偏差按 τ 指数衰减地并回模型。
 */
export const projectSeries = (
  pInf: number,
  tau: number,
  fromRun: number,
  fromValue: number,
  toRun: number,
  steps = 90,
) => {
  const model = (n: number) => pInf * (1 - Math.exp(-n / tau));
  const offset = fromValue - model(fromRun);
  return Array.from({ length: steps }, (_, k) => {
    const run = fromRun + (k / (steps - 1)) * (toRun - fromRun);
    return {
      n: Math.min(pInf, model(run) + offset * Math.exp(-(run - fromRun) / tau)),
      run,
    };
  });
};
