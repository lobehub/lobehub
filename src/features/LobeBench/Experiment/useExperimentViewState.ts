import { useEffect, useState } from 'react';

import type { ExperimentCaseFilter } from '@/features/LobeBench/experimentResults';
import type { CaseLevel } from '@/features/LobeBench/lobeBench';

/**
 * View choices that belong to one experiment: the selected benchmark part,
 * case filters and the open case. They reset when the route opens another
 * experiment, so a choice made on one never points into the next.
 */
export const useExperimentViewState = (experimentId?: string) => {
  const [partIndex, setPartIndex] = useState(0);
  const [filterOverride, setFilter] = useState<ExperimentCaseFilter>();
  const [category, setCategory] = useState<string>();
  const [level, setLevel] = useState<CaseLevel>();
  const [openCase, setOpenCase] = useState<string>();
  useEffect(() => {
    setPartIndex(0);
    setFilter(undefined);
    setCategory(undefined);
    setLevel(undefined);
    setOpenCase(undefined);
  }, [experimentId]);

  return {
    category,
    filterOverride,
    level,
    openCase,
    partIndex,
    setCategory,
    setFilter,
    setLevel,
    setOpenCase,
    setPartIndex,
  };
};
