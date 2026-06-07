'use client';

import type { BuiltinPortalProps } from '@lobechat/types';
import { Center } from '@lobehub/ui';
import { memo } from 'react';

import type { GenerateVerifyPlanParams, GenerateVerifyPlanState } from '../../types';
import { LobeDeliveryCheckerApiName } from '../../types';
import CriterionDetail, { type CriterionView } from './CriterionDetail';
import RubricConfig from './RubricConfig';

/**
 * One Portal per tool, routed on `apiName`. Currently only `generateVerifyPlan`
 * has a deep-dive view: clicking a check row in the Render opens the criterion's
 * full configuration here, focused via `params.index`.
 */
const Portal = memo<BuiltinPortalProps>(({ apiName, arguments: args, params, state }) => {
  switch (apiName) {
    case LobeDeliveryCheckerApiName.generateVerifyPlan: {
      const index = typeof params?.index === 'number' ? params.index : 0;
      const planArgs = args as GenerateVerifyPlanParams | undefined;
      const planState = state as GenerateVerifyPlanState | undefined;

      // Rubric-level run-policy config (maxRepairRounds, …) — opened from the
      // Render card's settings affordance.
      if (params?.view === 'rubric') {
        return planState?.rubricId ? <RubricConfig rubricId={planState.rubricId} /> : null;
      }

      const input = planArgs?.criteria?.[index];
      const item = planState?.items?.[index];

      // Prefer the model's full input (it carries `instruction`); the persisted
      // item carries the ids needed to write edits back.
      const criterion: CriterionView | undefined =
        input || item
          ? {
              criterionId: item?.criterionId,
              description: input?.description ?? item?.description,
              documentId: item?.documentId,
              instruction: input?.instruction,
              onFail: input?.onFail ?? item?.onFail ?? 'auto_repair',
              required: input?.required ?? item?.required ?? true,
              title: input?.title ?? item?.title ?? '',
              verifierType: input?.verifierType ?? item?.verifierType ?? 'llm',
            }
          : undefined;

      if (!criterion) return null;

      return <CriterionDetail criterion={criterion} />;
    }
  }

  return <Center height={'100%'} />;
});

Portal.displayName = 'LobeDeliveryCheckerPortal';

export default Portal;
