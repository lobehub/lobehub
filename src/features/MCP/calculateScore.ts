import { type DeploymentOption } from '@lobehub/market-types';

import { type DiscoverMcpDetail } from '@/types/discover';

export interface ScoreItem {
  check: boolean;
  required?: boolean;
  weight?: number; // weight, optional
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

// Extended score item interface, used for display
export interface ScoreListItem extends ScoreItem {
  desc: string;
  key: string;
  title: string;
}

// Raw data interface
export interface ScoreDataInput {
  deploymentOptions?: Array<{
    installationMethod?: string;
  }>;
  github?: {
    license?: string;
  };
  installationMethods?: string; // Used by list page
  isClaimed?: boolean;
  isValidated?: boolean;
  overview?: {
    readme?: string;
  };
  promptsCount?: number;
  resourcesCount?: number;
  toolsCount?: number;
}

// Calculated boolean result
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

  // Required
  deployMoreThanManual: 12,

  deployment: 15,

  // Required
  license: 8,

  // Required
  prompts: 8,

  readme: 10,

  resources: 8,
  // Required, highest weight
  tools: 15,
  validated: 20,
};

// Score calculation input data type
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
  installationMethods?: string; // Used by list page
  isClaimed?: boolean; // Add isClaimed property
}

/**
 * Calculates all score flags from raw data
 * @param data Raw data
 * @returns Calculated boolean flags
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

  // Calculate base flags
  const hasReadme = Boolean(overview?.readme);
  const hasLicense = Boolean(github?.license);

  // Prefer deploymentOptions (detail page), then fall back to installationMethods (list page)
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
 * Gets the color corresponding to the grade
 * @param grade Grade
 * @param theme Theme object (optional)
 * @returns Color value
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

  // Default color values (for when no theme object is provided)
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
 * Gets the style class name mapping corresponding to the grade
 * @param grade Grade
 * @param styles Styles object
 * @returns Corresponding style class name
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
 * Sorts score items by priority
 * @param items Score item array
 * @returns Sorted item array
 */
export function sortItemsByPriority<T extends ScoreItem>(items: T[]): T[] {
  return items.sort((a, b) => {
    // 1. Required items first
    if (a.required !== b.required) {
      return a.required ? -1 : 1;
    }

    // 2. By weight from high to low
    const weightA = a.weight || 0;
    const weightB = b.weight || 0;
    if (weightA !== weightB) {
      return weightB - weightA;
    }

    // 3. Completed items first
    if (a.check !== b.check) {
      return a.check ? -1 : 1;
    }

    return 0;
  });
}

/**
 * Calculates the total score and grade for an MCP Server
 * @param items Score items
 * @param weights Weight configuration, defaults to DEFAULT_WEIGHTS
 * @returns Result containing total score, max score, percentage, and grade
 */
export function calculateScore(
  items: Record<string, ScoreItem>,
  weights: Record<string, number> = DEFAULT_WEIGHTS,
): ScoreResult {
  let totalScore = 0;
  let maxScore = 0;
  let requiredScore = 0;
  let maxRequiredScore = 0;

  // Calculate actual score and maximum possible score
  Object.entries(items).forEach(([key, item]) => {
    const weight = weights[key] || 5; // Default weight is 5
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

  // Grade calculation logic
  let grade: 'a' | 'b' | 'f';

  // If not all required items are met, grade as F directly
  if (requiredPercentage < 100) {
    grade = 'f';
  } else {
    // When all required items are met, grade based on total score percentage
    if (percentage >= 80) {
      grade = 'a'; // 80% and above is A
    } else if (percentage >= 60) {
      grade = 'b'; // 60-79% is B
    } else {
      grade = 'f'; // Below 60% is F
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
 * Creates an object for calculation from score item data
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
