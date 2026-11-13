import { useState } from 'react';

import {
  usePlanSkill,
  useSkillVersion,
} from '@/features/AgentGoals/ProcessControl/BatchPlan/skillVersions';

/**
 * The plan skill's directory under review. A plan that ships scripts or
 * references opens on its whole directory, so the owner sees every file it
 * carries; a lone `SKILL.md` reads as a document until they open the tree.
 * Shares the directory's requests, so it costs no second fetch.
 */
export const usePlanFiles = (skillId: string | undefined, revision: number) => {
  const { data: skill } = usePlanSkill(skillId);
  const { data: shipped } = useSkillVersion(skillId, revision);
  // What sits beside `SKILL.md` in the reviewed version (not `SKILL.md` itself).
  const extraFiles = (shipped?.files ?? skill?.files ?? []).length;
  const [toggled, setToggled] = useState<boolean>();
  const filesOpen = toggled ?? extraFiles > 0;
  return {
    extraFiles,
    filesOpen,
    toggleFiles: () => setToggled(!filesOpen),
  };
};
