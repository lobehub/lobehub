'use client';

import type { EvalRunTopicResult } from '@lobechat/types';
import { formatCost, formatShortenNumber } from '@lobechat/utils';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Footprints,
  Hash,
} from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  backLink: {
    cursor: 'pointer',
    alignSelf: 'flex-start',
    borderRadius: cssVar.borderRadiusSM,
    color: { 'default': cssVar.colorTextTertiary, ':hover': cssVar.colorText },
    transition: {
      'default': 'color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    outlineWidth: { 'default': null, ':focus-visible': '2px' },
    outlineStyle: { 'default': null, ':focus-visible': 'solid' },
    outlineColor: { 'default': null, ':focus-visible': cssVar.colorPrimary },
    outlineOffset: { 'default': null, ':focus-visible': '2px' },
  },
  header: {
    paddingBlock: '16px',
    paddingInline: '16px',
    borderBlockEndWidth: '1px',
    borderBlockEndStyle: 'solid',
    borderBlockEndColor: cssVar.colorBorderSecondary,
  },
  metricCard: {
    gap: '8px',
    paddingBlock: '8px',
    paddingInlineStart: '8px',
    paddingInlineEnd: '16px',
    borderRadius: cssVar.borderRadiusSM,
    fontSize: cssVar.fontSizeSM,
    backgroundColor: cssVar.colorBgContainer,
    backgroundImage: 'none',
  },
  metricIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '28px',
    height: '28px',
    borderRadius: cssVar.borderRadiusSM,
    color: cssVar.colorTextTertiary,
    backgroundColor: cssVar.colorFillTertiary,
    backgroundImage: 'none',
  },
  metricLabel: { fontSize: cssVar.fontSizeSM, lineHeight: 1, color: cssVar.colorTextTertiary },
  metricValue: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSize,
    fontWeight: 500,
    lineHeight: 1.4,
    color: cssVar.colorText,
  },
});

interface CaseHeaderProps {
  caseNumber: number;
  evalResult?: EvalRunTopicResult | null;
  onBack: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  runName: string;
}

const CaseHeader = memo<CaseHeaderProps>(
  ({ caseNumber, runName, evalResult, onBack, onPrev, onNext }) => {
    const { t } = useTranslation('eval');

    const metrics = [
      {
        icon: Clock,
        label: t('caseDetail.duration'),
        value: evalResult?.duration != null ? `${(evalResult.duration / 1000).toFixed(1)}s` : null,
      },
      {
        icon: Footprints,
        label: t('caseDetail.steps'),
        value: evalResult?.steps != null ? String(evalResult.steps) : null,
      },
      {
        icon: DollarSign,
        label: t('caseDetail.cost'),
        value: evalResult?.cost != null ? `$${formatCost(evalResult.cost)}` : null,
      },
      {
        icon: Hash,
        label: t('caseDetail.tokens'),
        value: evalResult?.tokens != null ? formatShortenNumber(evalResult.tokens) : null,
      },
    ].filter((m) => m.value !== null);

    return (
      <Flexbox className={stylex.props(styles.header).className} gap={16}>
        {/* Identity row: breadcrumb back + case number + prev/next nav */}
        <Flexbox horizontal align="center" gap={8} justify="space-between">
          <Flexbox gap={4}>
            <Flexbox
              horizontal
              align="center"
              className={stylex.props(styles.backLink).className}
              gap={4}
              role="button"
              tabIndex={0}
              onClick={onBack}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onBack();
                }
              }}
            >
              <ArrowLeft size={12} />
              <Text fontSize={12}>{runName}</Text>
            </Flexbox>
            <Text as="h4" style={{ fontSize: 20, margin: 0 }} weight={600}>
              #{caseNumber}
            </Text>
          </Flexbox>

          <Flexbox horizontal align="center" gap={8}>
            <ActionIcon disabled={!onPrev} icon={ChevronLeft} size="small" onClick={onPrev} />
            <ActionIcon disabled={!onNext} icon={ChevronRight} size="small" onClick={onNext} />
          </Flexbox>
        </Flexbox>

        {metrics.length > 0 && (
          <Flexbox horizontal align="center" gap={8} wrap="wrap">
            {metrics.map((m) => (
              <Flexbox
                horizontal
                align="center"
                className={stylex.props(styles.metricCard).className}
                key={m.label}
              >
                <div {...stylex.props(styles.metricIcon)}>
                  <m.icon size={14} />
                </div>
                <Flexbox gap={0}>
                  <span {...stylex.props(styles.metricLabel)}>{m.label}</span>
                  <span {...stylex.props(styles.metricValue)}>{m.value}</span>
                </Flexbox>
              </Flexbox>
            ))}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

export default CaseHeader;
