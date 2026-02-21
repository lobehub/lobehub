import { useTranslation } from 'react-i18next';

import { useDetailContext } from '@/features/MCPPluginDetail/DetailProvider';

import { type ScoreListItem } from './calculateScore';
import { calculateScoreFlags, DEFAULT_WEIGHTS } from './calculateScore';

/**
 * Hook for creating score list items with translations
 * 直接从 DetailContext 获取数据，完全自包含
 * @returns 包含描述和标题的评分项目列表
 */
export function useScoreList(): ScoreListItem[] {
  const { t } = useTranslation('discover');
  const {
    github,
    overview,
    isValidated,
    toolsCount,
    promptsCount,
    resourcesCount,
    deploymentOptions,
  } = useDetailContext();

  // 计算评分标志
  const scoreFlags = calculateScoreFlags({
    deploymentOptions,
    github,
    isClaimed: false, // 详情页暂时没有 claimed 状态
    isValidated,
    overview,
    promptsCount,
    resourcesCount,
    toolsCount,
  });

  return [
    {
      check: scoreFlags.hasReadme,
      desc: t('mcp.details.score.readme.desc'),
      key: 'readme',
      required: true,
      title: t('mcp.details.score.readme.title'),
      weight: DEFAULT_WEIGHTS.readme,
    },
    {
      check: scoreFlags.hasLicense,
      desc: scoreFlags.hasLicense
        ? t('mcp.details.score.license.descWithlicense', { license: github?.license })
        : t('mcp.details.score.license.desc'),
      key: 'license',
      required: false,
      title: t('mcp.details.score.license.title'),
      weight: DEFAULT_WEIGHTS.license,
    },
    {
      check: scoreFlags.hasDeployment,
      desc: scoreFlags.hasDeployment
        ? t('mcp.details.score.deployment.descWithCount', {
            number: deploymentOptions?.length,
          })
        : t('mcp.details.score.deployment.desc'),
      key: 'deployment',
      required: true,
      title: t('mcp.details.score.deployment.title'),
      weight: DEFAULT_WEIGHTS.deployment,
    },
    {
      check: scoreFlags.hasDeployMoreThanManual,
      desc: t('mcp.details.score.deployMoreThanManual.desc'),
      key: 'deployMoreThanManual',
      required: false,
      title: t('mcp.details.score.deployMoreThanManual.title'),
      weight: DEFAULT_WEIGHTS.deployMoreThanManual,
    },
    {
      check: scoreFlags.hasValidated,
      desc: t('mcp.details.score.validated.desc'),
      key: 'validated',
      required: true,
      title: t('mcp.details.score.validated.title'),
      weight: DEFAULT_WEIGHTS.validated,
    },
    {
      check: scoreFlags.hasTools,
      desc: scoreFlags.hasTools
        ? t('mcp.details.score.tools.descWithCount', { number: toolsCount })
        : t('mcp.details.score.tools.desc'),
      key: 'tools',
      required: true,
      title: t('mcp.details.score.tools.title'),
      weight: DEFAULT_WEIGHTS.tools,
    },
    {
      check: scoreFlags.hasPrompts,
      desc: scoreFlags.hasPrompts
        ? t('mcp.details.score.prompts.descWithCount', { number: promptsCount })
        : t('mcp.details.score.prompts.desc'),
      key: 'prompts',
      required: false,
      title: t('mcp.details.score.prompts.title'),
      weight: DEFAULT_WEIGHTS.prompts,
    },
    {
      check: scoreFlags.hasResources,
      desc: scoreFlags.hasResources
        ? t('mcp.details.score.resources.descWithCount', { number: resourcesCount })
        : t('mcp.details.score.resources.desc'),
      key: 'resources',
      required: false,
      title: t('mcp.details.score.resources.title'),
      weight: DEFAULT_WEIGHTS.resources,
    },
    {
      check: scoreFlags.hasClaimed,
      desc: scoreFlags.hasClaimed
        ? t('mcp.details.score.claimed.desc')
        : t('mcp.details.score.notClaimed.desc'),
      key: 'claimed',
      required: false,
      title: scoreFlags.hasClaimed
        ? t('mcp.details.score.claimed.title')
        : t('mcp.details.score.notClaimed.title'),
      weight: DEFAULT_WEIGHTS.claimed,
    },
  ];
}
