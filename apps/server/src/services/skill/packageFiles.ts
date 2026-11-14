import { z } from 'zod';

/**
 * The files a skill package holds beside its `SKILL.md`: references,
 * templates, scripts. These are the rules every way of submitting them shares,
 * so a package reads the same whoever wrote it.
 */

export const MAX_PACKAGE_FILES = 20;
export const MAX_PACKAGE_FILE_CHARS = 64_000;
export const MAX_PACKAGE_CHARS = 256_000;

/**
 * Path segments that name object built-ins. A package is zipped and served from
 * keyed objects, so such a path would set an object's prototype instead of
 * adding an entry.
 */
const OBJECT_BUILT_INS = new Set(['__proto__', 'constructor', 'prototype']);

export const namesObjectBuiltIn = (path: string) =>
  path.split('/').some((segment) => OBJECT_BUILT_INS.has(segment));

/**
 * A path inside the package, e.g. `scripts/check.sh` or `references/rules.md`.
 * Relative, no `..`, and never `SKILL.md`, which is written as the skill's body.
 */
export const packageFilePath = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\w.-]+(\/[\w.-]+)*$/, 'A package path is relative, like scripts/check.sh')
  .refine((path) => !path.split('/').includes('..'), 'A package path cannot leave the package')
  .refine(
    (path) => !namesObjectBuiltIn(path),
    'A package path cannot use __proto__, constructor or prototype as a name',
  )
  .refine(
    (path) => path.toLowerCase() !== 'skill.md',
    "SKILL.md is the skill's body; submit it as the body",
  );

/** Files that ship beside `SKILL.md`. Paths are unique; the package stays small enough to load. */
export const packageFilesSchema = z
  .array(
    z.object({ content: z.string().max(MAX_PACKAGE_FILE_CHARS), path: packageFilePath }).strict(),
  )
  .min(1)
  .max(MAX_PACKAGE_FILES)
  .refine(
    (files) => new Set(files.map((file) => file.path)).size === files.length,
    'Each package file needs its own path',
  )
  .refine(
    (files) => files.reduce((sum, file) => sum + file.content.length, 0) <= MAX_PACKAGE_CHARS,
    `A package holds at most ${MAX_PACKAGE_CHARS} characters of files`,
  );

export type PackageFile = z.infer<typeof packageFilesSchema>[number];
