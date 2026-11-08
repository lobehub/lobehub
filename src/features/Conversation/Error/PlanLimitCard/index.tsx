import { BRANDING_URL } from '@lobechat/business-const';
import { ChatErrorType, Plans } from '@lobechat/types';
import { Avatar, Button, Center, createStaticStyles, Flexbox, Text } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  formatCreditAmount,
  getBudgetContextFromErrorBody,
  getNextUpgradePlan,
  isKnownPlan,
  type PlanLimitPricingBasis,
} from './budget';

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

const styles = createStaticStyles(({ css, cssVar }) => ({
  centered: css`
    text-align: center;

    /* even line lengths: a wrapped sentence never leaves a lone character on the last line */
    text-wrap: balance;
  `,
  fact: css`
    display: flex;
    gap: 12px;
    justify-content: space-between;

    width: 100%;

    font-size: 13px;
    line-height: 1.4;
  `,
  factLabel: css`
    color: ${cssVar.colorTextSecondary};
  `,
  factValue: css`
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    color: ${cssVar.colorText};
    text-align: end;
    white-space: nowrap;
  `,
  factWarningValue: css`
    font-weight: 700;
    color: ${cssVar.colorError};
  `,
  facts: css`
    width: 100%;
  `,
  form: css`
    width: 100%;
    max-width: 360px;

    @media (width <= 768px) {
      max-width: 90%;
    }
  `,
  title: css`
    font-size: 16px;
    font-weight: bold;
  `,
}));

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
    <Center paddingBlock={12} width={'100%'}>
      <Flexbox className={styles.form} gap={16}>
        <Center gap={8}>
          <Avatar animation avatar={'💰'} background={'transparent'} size={40} />
          <Center gap={4}>
            <Text className={styles.title}>{title}</Text>
            <Text className={styles.centered} fontSize={13} type={'secondary'}>
              {description}
            </Text>
          </Center>
        </Center>

        {facts.length > 0 && (
          <Flexbox className={styles.facts} gap={8}>
            {facts.map((fact) => (
              <div className={styles.fact} key={fact.label}>
                <span className={styles.factLabel}>{fact.label}</span>
                <span
                  className={
                    fact.warning
                      ? `${styles.factValue} ${styles.factWarningValue}`
                      : styles.factValue
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
            <Button
              block
              href={BRANDING_URL.subscription}
              rel={'noopener noreferrer'}
              size={'large'}
              target={'_blank'}
              type={'primary'}
            >
              {upgradeLabel}
            </Button>
          )}
          <Button block size={'large'} onClick={onRetry}>
            {t('limitation.insufficientBudget.retry')}
          </Button>
        </Flexbox>
      </Flexbox>
    </Center>
  );
});

export default PlanLimitCard;
