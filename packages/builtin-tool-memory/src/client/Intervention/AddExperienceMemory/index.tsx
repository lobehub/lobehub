'use client';

import type { BuiltinInterventionProps } from '@lobechat/types';
import { memo } from 'react';

import type { AddExperienceMemoryParams } from '../../../types';
import { ExperienceMemoryCard } from '../../components';

const AddExperienceMemoryIntervention = memo<BuiltinInterventionProps<AddExperienceMemoryParams>>(
  ({ args }) => {
    return <ExperienceMemoryCard data={args} />;
  },
);

AddExperienceMemoryIntervention.displayName = 'AddExperienceMemoryIntervention';

export default AddExperienceMemoryIntervention;
