import { run } from './exec';
import { getConfig, mountDir } from './paths';
import { resolveMount } from './routing';
import type { RepoMount } from './types';

interface BaseFileStatus {
  baseRef: string;
  exists: boolean;
}

type InspectBaseFile = (file: string) => Promise<BaseFileStatus | undefined>;

const NEW_COMPONENT_TEST_PATTERN = /\.test\.tsx$/;
const TESTING_SKILL_REFERENCE =
  '.agents/skills/testing/SKILL.md (Core Principles: "No new component tests")';

const createBaseFileInspector = (): InspectBaseFile => {
  const mergeBases = new Map<RepoMount, Promise<string | undefined>>();

  return async (file) => {
    const { mount, subPath } = resolveMount(getConfig().repos, file);
    if (!mount.baseRef) return;

    let mergeBase = mergeBases.get(mount);
    if (!mergeBase) {
      // This advisory is best-effort: an unavailable local base skips it instead of failing checks.
      mergeBase = run('git', ['merge-base', 'HEAD', mount.baseRef], mountDir(mount)).then(
        (result) => (result.code === 0 ? result.stdout.trim() || undefined : undefined),
      );
      mergeBases.set(mount, mergeBase);
    }

    const baseCommit = await mergeBase;
    // Unlike a missing file at a valid base, an unresolved base cannot prove the file is new.
    if (!baseCommit) return;

    const result = await run(
      'git',
      ['cat-file', '-e', `${baseCommit}:${subPath}`],
      mountDir(mount),
    );

    return {
      baseRef: mount.baseRef,
      exists: result.code === 0,
    };
  };
};

export const findNewComponentTestAdvisories = async (
  files: string[],
  inspectBaseFile: InspectBaseFile = createBaseFileInspector(),
): Promise<string[]> => {
  const candidates = [...new Set(files.filter((file) => NEW_COMPONENT_TEST_PATTERN.test(file)))];
  const statuses = await Promise.all(candidates.map((file) => inspectBaseFile(file)));

  return candidates.flatMap((file, index) => {
    const status = statuses[index];
    if (!status || status.exists) return [];

    return [
      `${file}: new .test.tsx file relative to ${status.baseRef}. New React component tests are not allowed; extract complex logic into a hook and test it in .test.ts instead (${TESTING_SKILL_REFERENCE}).`,
    ];
  });
};
