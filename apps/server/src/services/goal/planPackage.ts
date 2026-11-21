import { z } from 'zod';

import { MAX_PACKAGE_FILES, packageFilePath, packageFilesSchema } from '../skill/packageFiles';

/**
 * A batch plan is a package, not one document: `SKILL.md` (the recipe) plus
 * whatever the main Agent gathered while working out how a unit is done —
 * references, templates, scripts. Every unit loads it as a skill and reads a
 * file here through it (`readReference`) to use as it is — a script is run as
 * written, not rewritten — and the owner reviews it with the plan.
 */

/**
 * What a rewritten plan changes in its package: files to add or replace (by
 * path) and paths to drop. Files it does not name stay as they were.
 */
export const planFileEdits = {
  files: packageFilesSchema.optional(),
  removeFiles: z.array(packageFilePath).min(1).max(MAX_PACKAGE_FILES).optional(),
};
