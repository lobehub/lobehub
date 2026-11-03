'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { memo } from 'react';

import type { CreatePlanParams, CreatePlanState } from '../../../types';
import PlanCard from './PlanCard';

export type CreatePlanRenderProps = Pick<
  BuiltinRenderProps<CreatePlanParams, CreatePlanState>,
  'pluginState'
>;

const CreatePlan = memo<CreatePlanRenderProps>(({ pluginState }) => {
  const { plan } = pluginState || {};

  if (!plan) {
    return null;
  }

  return <PlanCard plan={plan} />;
});

export default CreatePlan;
export { default as PlanCard } from './PlanCard';
