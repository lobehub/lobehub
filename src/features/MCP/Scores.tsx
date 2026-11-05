'use client';

import { Center, Flexbox, Icon, stopPropagation, Tooltip } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleDashedIcon, HammerIcon, LayersIcon, MessageSquareQuoteIcon } from 'lucide-react';
import qs from 'query-string';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import urlJoin from 'url-join';

import { Link } from '@/libs/router';
import { McpNavKey } from '@/types/discover';

import { calculateScore, calculateScoreFlags, createScoreItems } from './calculateScore';

const styles = stylex.create({
  disable: {
    color: cssVar.colorTextDescription,
  },
  extraTag: {
    paddingBlock: '4px',
    paddingInlineStart: '10px',
    paddingInlineEnd: '12px',
    borderRadius: '16px',
    color: cssVar.colorTextSecondary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  extraTagActive: {
    color: { 'default': null, ':hover': cssVar.colorText },
  },
  gradeA: {
    color: cssVar.colorSuccess,
    backgroundColor: cssVar.colorSuccessBg,
    backgroundImage: 'none',
  },
  gradeB: {
    color: cssVar.colorWarning,
    backgroundColor: cssVar.colorWarningBg,
    backgroundImage: 'none',
  },
  gradeF: {
    color: cssVar.colorError,
    backgroundColor: cssVar.colorErrorBg,
    backgroundImage: 'none',
  },
  gradeIcon: {
    flex: 'none',
    width: '22px',
    height: '22px',
    borderWidth: '1.5px',
    borderStyle: 'solid',
    borderRadius: '50%',
    fontSize: '12px',
    fontWeight: 600,
  },
  tag: {
    paddingBlock: '4px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '12px',
    borderRadius: '16px',
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
});

const gradeStyle = (grade: string) => {
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
      return styles.disable;
    }
  }
};

interface ScoresProps {
  deploymentOptions?: Array<{
    installationMethod?: string;
  }>;
  github?: {
    license?: string;
  };
  identifier: string;
  // List page support
  installationMethods?: string;
  isClaimed?: boolean;
  isValidated?: boolean;
  // Raw data properties
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

    // Use utility function to calculate all has* values, but need to handle type conversion
    const scoreFlags = calculateScoreFlags({
      // Only pass compatible properties, or perform type conversion
      deploymentOptions: deploymentOptions?.map((item) => ({
        // Ensure not undefined
        connection: { type: 'stdio' as const },
        installationMethod: item.installationMethod || 'manual', // Provide default connection
      })),
      github: github?.license
        ? {
            license: github.license,
            url: '', // Provide default url
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

    // Calculate score
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
          className={stylex.props(styles.tag, gradeStyle(grade)).className}
          gap={8}
          style={{
            paddingLeft: 4,
          }}
        >
          <Center
            className={stylex.props(styles.gradeIcon).className}
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
          className={stylex.props(styles.tag).className}
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
            <Flexbox
              horizontal
              align={'center'}
              className={stylex.props(styles.extraTag).className}
              gap={16}
            >
              {showToolts && (
                <Tooltip
                  title={[
                    t('mcp.details.schema.tools.title'),
                    t('mcp.details.schema.tools.desc'),
                  ].join(': ')}
                >
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={stylex.props(styles.extraTagActive).className}
                    gap={8}
                  >
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
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={stylex.props(styles.extraTagActive).className}
                    gap={8}
                  >
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
                  <Flexbox
                    horizontal
                    align={'center'}
                    className={stylex.props(styles.extraTagActive).className}
                    gap={8}
                  >
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
