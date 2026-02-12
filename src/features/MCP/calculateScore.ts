import { type DeploymentOption } from '@lobehub/market-types';

import { type DiscoverMcpDetail } from '@/types/discover';

export interface ScoreItem {
  check: boolean;
  required?: boolean;
  weight?: number; // 权重，可选
}

export interface ScoreResult {
  grade: 'a' | 'b' | 'f';
  maxRequiredScore: number;
  maxScore: number;
  percentage: number;
  requiredPercentage: number;
  requiredScore: number;
  totalScore: number;
}

// 扩展的评分项目接口，用于显示
export interface ScoreListItem extends ScoreItem {
  desc: string;
  key: string;
  title: string;
}

// 原始数据接口
export interface ScoreDataInput {
  deploymentOptions?: Array<{
    installationMethod?: string;
  }>;
  github?: {
    license?: string;
  };
  installationMethods?: string; // 列表页使用
  isClaimed?: boolean;
  isValidated?: boolean;
  overview?: {
    readme?: string;
  };
  promptsCount?: number;
  resourcesCount?: number;
  toolsCount?: number;
}

// 计算后的布尔值结果
export interface ScoreFlags {
  hasClaimed: boolean;
  hasDeployment: boolean;
  hasDeployMoreThanManual: boolean;
  hasLicense: boolean;
  hasPrompts: boolean;
  hasReadme: boolean;
  hasResources: boolean;
  hasTools: boolean;
  hasValidated: boolean;
}

export const DEFAULT_WEIGHTS = {
  claimed: 4,

  // 必需项
  deployMoreThanManual: 12,

  deployment: 15,

  // 必需项
  license: 8,

  // 必需项
  prompts: 8,

  readme: 10,

  resources: 8,
  // 必需项，权重最高
  tools: 15,
  validated: 20,
};

// 评分计算输入数据类型
export interface ScoreCalculationInput extends Partial<
  Pick<
    DiscoverMcpDetail,
    | 'deploymentOptions'
    | 'github'
    | 'isValidated'
    | 'overview'
    | 'promptsCount'
    | 'resourcesCount'
    | 'toolsCount'
  >
> {
  installationMethods?: string; // 列表页使用
  isClaimed?: boolean; // 添加 isClaimed 属性
}

/**
 * 根据原始数据计算所有的评分标志
 * @param data 原始数据
 * @returns 计算后的布尔值标志
 */
export function calculateScoreFlags(data: ScoreCalculationInput): ScoreFlags {
  const {
    overview,
    github,
    deploymentOptions,
    installationMethods,
    isValidated,
    toolsCount,
    promptsCount,
    resourcesCount,
    isClaimed,
  } = data;

  // 计算基础标志
  const hasReadme = Boolean(overview?.readme);
  const hasLicense = Boolean(github?.license);

  // 优先使用 deploymentOptions（详情页），然后使用 installationMethods（列表页）
  const effectiveDeploymentOptions: DeploymentOption[] =
    deploymentOptions ||
    (installationMethods ? [{ installationMethod: installationMethods } as DeploymentOption] : []);

  const hasDeployment = Boolean(
    effectiveDeploymentOptions && effectiveDeploymentOptions.length > 0,
  );
  const hasDeployMoreThanManual = Boolean(
    hasDeployment &&
    effectiveDeploymentOptions?.find((item) => item.installationMethod !== 'manual'),
  );

  const hasTools = Boolean(toolsCount && toolsCount > 0);
  const hasPrompts = Boolean(promptsCount && promptsCount > 0);
  const hasResources = Boolean(resourcesCount && resourcesCount > 0);
  const hasValidated = Boolean(isValidated);
  const hasClaimed = Boolean(isClaimed);

  return {
    hasClaimed,
    hasDeployMoreThanManual,
    hasDeployment,
    hasLicense,
    hasPrompts,
    hasReadme,
    hasResources,
    hasTools,
    hasValidated,
  };
}

/**
 * 获取评级对应的颜色
 * @param grade 评级
 * @param theme 主题对象（可选）
 * @returns 颜色值
 */
export function getGradeColor(grade: string, theme?: any): string {
  if (theme) {
    switch (grade) {
      case 'a': {
        return theme.colorSuccess;
      }
      case 'b': {
        return theme.colorWarning;
      }
      case 'f': {
        return theme.colorError;
      }
      default: {
        return theme.colorTextSecondary || theme.colorBorderSecondary;
      }
    }
  }

  // 默认颜色值（用于没有主题对象的情况）
  switch (grade) {
    case 'a': {
      return '#52c41a';
    }
    case 'b': {
      return '#faad14';
    }
    case 'f': {
      return '#ff4d4f';
    }
    default: {
      return '#8c8c8c';
    }
  }
}

/**
 * 获取评级对应的样式类名映射
 * @param grade 评级
 * @param styles 样式对象
 * @returns 对应的样式类名
 */
export function getGradeStyleClass(grade: string, styles: any): string {
  switch (grade) {
    case 'a': {
      return styles.gradeA;
    }
    case 'b': {
      return styles.gradeB;
    }
    case 'f': {
      return styles.gradeF;
    }
    default: {
      return styles.disable || '';
    }
  }
}

/**
 * 按优先级排序评分项目
 * @param items 评分项目数组
 * @returns 排序后的项目数组
 */
export function sortItemsByPriority<T extends ScoreItem>(items: T[]): T[] {
  return items.sort((a, b) => {
    // 1. 必需项优先
    if (a.required !== b.required) {
      return a.required ? -1 : 1;
    }

    // 2. 按权重从高到低
    const weightA = a.weight || 0;
    const weightB = b.weight || 0;
    if (weightA !== weightB) {
      return weightB - weightA;
    }

    // 3. 已完成的在前
    if (a.check !== b.check) {
      return a.check ? -1 : 1;
    }

    return 0;
  });
}

/**
 * 计算 MCP Server 的总分和评级
 * @param items 评分项目
 * @param weights 权重配置，默认使用 DEFAULT_WEIGHTS
 * @returns 包含总分、最高分、百分比和评级的结果
 */
export function calculateScore(
  items: Record<string, ScoreItem>,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
): ScoreResult {
  let totalScore = 0;
  let maxScore = 0;
  let requiredScore = 0;
  let maxRequiredScore = 0;

  // 计算实际得分和最大可能得分
  Object.entries(items).forEach(([key, item]) => {
    const weight = weights[key] || 5; // 默认权重为 5
    maxScore += weight;

    if (item.required) {
      maxRequiredScore += weight;
      if (item.check) {
        requiredScore += weight;
      }
    }

    if (item.check) {
      totalScore += weight;
    }
  });

  const percentage = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;
  const requiredPercentage = maxRequiredScore > 0 ? (requiredScore / maxRequiredScore) * 100 : 0;

  // 评级计算逻辑
  let grade: 'a' | 'b' | 'f';

  // 如果必需项没有全部满足，直接评为 F
  if (requiredPercentage < 100) {
    grade = 'f';
  } else {
    // 必需项全部满足的情况下，根据总分百分比评级
    if (percentage >= 80) {
      grade = 'a'; // 80% 以上为 A
    } else if (percentage >= 60) {
      grade = 'b'; // 60-79% 为 B
    } else {
      grade = 'f'; // 60% 以下为 F
    }
  }

  return {
    grade,
    maxRequiredScore,
    maxScore,
    percentage,
    requiredPercentage,
    requiredScore,
    totalScore,
  };
}

/**
 * 根据评分项目数据创建用于计算的对象
 */
export function createScoreItems(data: ScoreFlags): Record<string, ScoreItem> {
  return {
    claimed: { check: data.hasClaimed },
    deployMoreThanManual: { check: data.hasDeployMoreThanManual },
    deployment: { check: data.hasDeployment, required: true },
    license: { check: data.hasLicense },
    prompts: { check: data.hasPrompts },
    readme: { check: data.hasReadme, required: true },
    resources: { check: data.hasResources },
    tools: { check: data.hasTools, required: true },
    validated: { check: data.hasValidated, required: true },
  };
}
