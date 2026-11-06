import { BRANDING_URL } from '@lobechat/business-const';
import { ChatErrorType, Plans } from '@lobechat/types';
import { Button, Flexbox } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { formatIntergerNumber, formatNumber } from '@/utils/format';

import { ErrorActionContainer, FormAction } from '../style';
import {
  getBudgetContextFromErrorBody,
  getNextUpgradePlan,
  isKnownPlan,
  type PlanLimitPricingBasis,
} from './budget';

/** Credits are displayed in units of 1M */
const CREDIT_UNIT = 1_000_000;

/** Plans with a `plans.plan.<id>.title` locale key */
const PLAN_TITLE_KEYS = {
  [Plans.Free]: 'plans.plan.free.title',
  [Plans.Hobby]: 'plans.plan.hobby.title',
  [Plans.Max]: 'plans.plan.max.title',
  [Plans.Plus]: 'plans.plan.plus.title',
  [Plans.Premium]: 'plans.plan.premium.title',
  [Plans.Pro]: 'plans.plan.pro.title',
  [Plans.Starter]: 'plans.plan.starter.title',
  [Plans.Ultimate]: 'plans.plan.ultimate.title',
} as const satisfies Record<Plans, string>;

const styles = stylex.create({
  budgetFact: {
    display: 'flex',
    justifyContent: 'space-between',
    width: '100%',
    fontSize: '13px',
    lineHeight: 1.4,
  },
  budgetFactLabel: { color: cssVar.colorTextTertiary },
  budgetFactValue: { fontWeight: 600, color: cssVar.colorText, whiteSpace: 'nowrap' },
  budgetFactWarningValue: { fontWeight: 700, color: cssVar.colorError },
  budgetFacts: { width: '100%' },
});

const getBudgetDescriptionKey = (pricingBasis?: PlanLimitPricingBasis) => {
  switch (pricingBasis) {
    case 'approximate': {
      return 'limitation.insufficientBudget.approximateDesc';
    }
    case 'estimated': {
      return 'limitation.insufficientBudget.estimatedDesc';
    }
    case 'exact': {
      return 'limitation.insufficientBudget.exactDesc';
    }
    default: {
      return 'limitation.insufficientBudget.desc';
    }
  }
};

const formatCreditAmount = (credits: number): string => {
  if (credits >= CREDIT_UNIT) return `${formatNumber(credits / CREDIT_UNIT, 2)}M`;

  return formatIntergerNumber(credits);
};

interface PlanLimitCardProps {
  errorBody?: unknown;
  errorType?: string;
  onRetry: () => void;
}

/**
 * Lightweight fallback for cloud billing errors. Used in builds without the
 * business override (e.g. desktop), so it only reads the budget snapshot from
 * the error body and links to the web plans page instead of fetching live
 * subscription state.
 */
const PlanLimitCard = memo<PlanLimitCardProps>(({ errorBody, errorType, onRetry }) => {
  const { t } = useTranslation('subscription');

  const context = getBudgetContextFromErrorBody(errorBody);
  const isInsufficientBudget = errorType === ChatErrorType.InsufficientBudgetForModel;

  const planAtError = isKnownPlan(context?.planAtError) ? context.planAtError : Plans.Free;

  const getPlanTitle = (plan: Plans) => t(PLAN_TITLE_KEYS[plan]);

  const nextPlan = getNextUpgradePlan(planAtError);
  const title = isInsufficientBudget
    ? t('limitation.insufficientBudget.title')
    : t('limitation.limited.title');
  const description = isInsufficientBudget
    ? t(getBudgetDescriptionKey(context?.pricingBasis))
    : t('limitation.limited.desc', { plan: getPlanTitle(planAtError) });
  const upgradeLabel = nextPlan
    ? t('limitation.limited.upgradeToPlan', { plan: getPlanTitle(nextPlan) })
    : t('limitation.limited.upgrade');

  const facts = (
    [
      {
        label: t('limitation.insufficientBudget.required'),
        value: context?.requiredCredits,
        warning: false,
      },
      {
        label: t('limitation.insufficientBudget.shortfall'),
        value: context?.shortfallCredits,
        warning: true,
      },
    ] as const
  ).filter((fact) => fact.value !== undefined && fact.value > 0);

  return (
    <ErrorActionContainer>
      <FormAction animation avatar={'💰'} description={description} title={title}>
        {facts.length > 0 && (
          <Flexbox className={stylex.props(styles.budgetFacts).className} gap={8}>
            {facts.map((fact) => (
              <div {...stylex.props(styles.budgetFact)} key={fact.label}>
                <span {...stylex.props(styles.budgetFactLabel)}>{fact.label}</span>
                <span
                  className={
                    fact.warning
                      ? stylex.props(styles.budgetFactValue, styles.budgetFactWarningValue)
                          .className
                      : stylex.props(styles.budgetFactValue).className
                  }
                >
                  {formatCreditAmount(fact.value!)}
                </span>
              </div>
            ))}
          </Flexbox>
        )}

        <Flexbox gap={8} width={'100%'}>
          {BRANDING_URL.subscription && (
            <a
              href={BRANDING_URL.subscription}
              rel={'noopener noreferrer'}
              style={{ width: '100%' }}
              target={'_blank'}
            >
              <Button block size={'large'} type={'primary'}>
                {upgradeLabel}
              </Button>
            </a>
          )}
          <Button block size={'large'} onClick={onRetry}>
            {t('limitation.insufficientBudget.retry')}
          </Button>
        </Flexbox>
      </FormAction>
    </ErrorActionContainer>
  );
});

export default PlanLimitCard;
