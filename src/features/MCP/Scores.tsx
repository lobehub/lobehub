'use client';

import { Center, Flexbox, Icon, Tooltip, stopPropagation } from '@lobehub/ui';
import { createStaticStyles, cssVar, cx } from 'antd-style';
import { CircleDashedIcon, HammerIcon, LayersIcon, MessageSquareQuoteIcon } from 'lucide-react';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { Link } from '@/libs/router';
import { McpNavKey } from '@/types/discover';

import {
  calculateScore,
  calculateScoreFlags,
  createScoreItems,
  getGradeStyleClass,
} from './calculateScore';

const styles = createStaticStyles(({ css }) => {
  return {
    active: css`
      background: ${cssVar.colorSuccessBgHover};
    `,
    disable: css`
      color: ${cssVar.colorTextDescription};
    `,
    extraTag: css`
      padding-block: 4px;
      padding-inline: 10px 12px;
      border-radius: 16px;

      color: ${cssVar.colorTextSecondary};

      background: ${cssVar.colorFillTertiary};
    `,
    extraTagActive: css`
      &:hover {
        color: ${cssVar.colorText};
      }
    `,
    gradeA: css`
      color: ${cssVar.colorSuccess};
      background: ${cssVar.colorSuccessBg};
    `,
    gradeB: css`
      color: ${cssVar.colorWarning};
      background: ${cssVar.colorWarningBg};
    `,
    gradeF: css`
      color: ${cssVar.colorError};
      background: ${cssVar.colorErrorBg};
    `,
    gradeIcon: css`
      flex: none;

      width: 22px;
      height: 22px;
      border: 1.5px solid;
      border-radius: 50%;

      font-size: 12px;
      font-weight: 600;
    `,
    tag: css`
      padding-block: 4px;
      padding-inline: 8px 12px;
      border-radius: 16px;
      background: ${cssVar.colorFillTertiary};
    `,
  };
});

interface ScoresProps {
  deploymentOptions?: Array<{
    installationMethod?: string;
  }>;
  github?: {
    license?: string;
  };
  identifier: string;
  // 列表页支持
  installationMethods?: string;
  isClaimed?: boolean;
  isValidated?: boolean;
  // 原始数据属性
  overview?: {
    readme?: string;
  };
  promptsCount?: number;
  resourcesCount?: number;
  toolsCount?: number;
}

const Scores = memo<ScoresProps>(
  ({
    identifier,
    promptsCount,
    toolsCount,
    resourcesCount,
    isValidated,
    overview,
    github,
    deploymentOptions,
    isClaimed = false,
    installationMethods,
  }) => {
    const { t } = useTranslation('discover');

    // 使用工具函数计算所有的 has* 值，但需要处理类型转换
    const scoreFlags = calculateScoreFlags({
      // 只传递兼容的属性，或者进行类型转换
      deploymentOptions: deploymentOptions?.map((item) => ({
        // 确保不为 undefined
        connection: { type: 'stdio' as const },
        installationMethod: item.installationMethod || 'manual', // 提供默认的 connection
      })),
      github: github?.license
        ? {
            license: github.license,
            url: '', // 提供默认的 url
          }
        : undefined,
      installationMethods,
      isClaimed,
      isValidated,
      overview: overview?.readme
        ? {
            readme: overview.readme,
          }
        : undefined,
      promptsCount,
      resourcesCount,
      toolsCount,
    });

    // 计算评分
    const scoreItems = createScoreItems(scoreFlags);
    const scoreResult = calculateScore(scoreItems);
    const { grade, percentage } = scoreResult;

    const showToolts = Boolean(toolsCount && toolsCount > 0);
    const showResources = Boolean(resourcesCount && resourcesCount > 0);
    const showPrompts = Boolean(promptsCount && promptsCount > 0);

    const showExtra = showToolts || showResources || showPrompts;

    const scoreTag = (
      <Tooltip title={`${t(`mcp.details.scoreLevel.${grade}.desc`)} (${Math.round(percentage)}%)`}>
        <Flexbox
          horizontal
          align={'center'}
          className={cx(styles.tag, getGradeStyleClass(grade, styles))}
          gap={8}
          style={{
            paddingLeft: 4,
          }}
        >
          <Center
            className={styles.gradeIcon}
            style={{
              borderColor:
                grade === 'a'
                  ? cssVar.colorSuccess
                  : grade === 'b'
                    ? cssVar.colorWarning
                    : grade === 'f'
                      ? cssVar.colorError
                      : cssVar.colorTextSecondary,
            }}
          >
            {grade.toUpperCase()}
          </Center>
          <span style={{ fontWeight: 500 }}>
            {t(`mcp.details.scoreLevel.${grade}.title`).toUpperCase()}
          </span>
        </Flexbox>
      </Tooltip>
    );

    const unvalidatedTag = (
      <Tooltip title={t('mcp.unvalidated.desc')}>
        <Flexbox
          horizontal
          align={'center'}
          className={styles.tag}
          gap={8}
          style={{
            color: cssVar.colorTextDescription,
            paddingLeft: 4,
          }}
        >
          <Icon color={cssVar.colorTextQuaternary} icon={CircleDashedIcon} size={22} />
          {t('mcp.unvalidated.title')}
        </Flexbox>
      </Tooltip>
    );

    return (
      <Flexbox horizontal align={'center'} flex={'none'} gap={8} onClick={stopPropagation}>
        {identifier && (
          <Link
            href={qs.stringifyUrl({
              query: {
                activeTab: McpNavKey.Score,
              },
              url: urlJoin('/community/mcp', identifier),
            })}
          >
            {isValidated ? scoreTag : unvalidatedTag}
          </Link>
        )}
        {showExtra && (
          <Link
            href={qs.stringifyUrl({
              query: {
                activeTab: McpNavKey.Schema,
              },
              url: urlJoin('/community/mcp', identifier),
            })}
          >
            <Flexbox horizontal align={'center'} className={styles.extraTag} gap={16}>
              {showToolts && (
                <Tooltip
                  title={[
                    t('mcp.details.schema.tools.title'),
                    t('mcp.details.schema.tools.desc'),
                  ].join(': ')}
                >
                  <Flexbox horizontal align={'center'} className={styles.extraTagActive} gap={8}>
                    <Icon icon={HammerIcon} size={14} />
                    {toolsCount}
                  </Flexbox>
                </Tooltip>
              )}
              {showPrompts && (
                <Tooltip
                  title={[
                    t('mcp.details.schema.prompts.title'),
                    t('mcp.details.schema.prompts.desc'),
                  ].join(': ')}
                >
                  <Flexbox horizontal align={'center'} className={styles.extraTagActive} gap={8}>
                    <Icon icon={MessageSquareQuoteIcon} size={14} />
                    {promptsCount}
                  </Flexbox>
                </Tooltip>
              )}
              {showResources && (
                <Tooltip
                  title={[
                    t('mcp.details.schema.resources.title'),
                    t('mcp.details.schema.resources.desc'),
                  ].join(': ')}
                >
                  <Flexbox horizontal align={'center'} className={styles.extraTagActive} gap={8}>
                    <Icon icon={LayersIcon} size={14} />
                    {resourcesCount}
                  </Flexbox>
                </Tooltip>
              )}
            </Flexbox>
          </Link>
        )}
      </Flexbox>
    );
  },
);

export default Scores;
