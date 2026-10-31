import { useState } from 'react';

import { useClientDataSWR } from '@/libs/swr';
import { userSkillService } from '@/services/userSkill';

/**
 * The plan skill's directory under review. A plan that ships scripts or
 * references opens on its whole directory, so the owner sees every file it
 * carries; a lone `SKILL.md` reads as a document until they open the tree.
 * Shares the directory's request, so it costs no second fetch.
 */
export const usePlanFiles = (skillId?: string) => {
  const { data: skill } = useClientDataSWR(skillId ? ['goal-gate-plan-skill', skillId] : null, () =>
    userSkillService.get(skillId!),
  );
  // `files` holds what sits beside `SKILL.md`, not `SKILL.md` itself.
  const extraFiles = skill?.files?.length ?? 0;
  const [toggled, setToggled] = useState<boolean>();
  const filesOpen = toggled ?? extraFiles > 0;
  return {
    extraFiles,
    filesOpen,
    toggleFiles: () => setToggled(!filesOpen),
  };
};
