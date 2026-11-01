import { createBaseLocator } from './base';
import { run } from './exec';
import { mountDir } from './paths';

interface BaseFileStatus {
  baseRef: string;
  exists: boolean;
}

type InspectBaseFile = (file: string) => Promise<BaseFileStatus | undefined>;

const NEW_COMPONENT_TEST_PATTERN = /\.test\.tsx$/;
const TESTING_SKILL_REFERENCE =
  '.agents/skills/testing/SKILL.md (Core Principles: "No new component tests")';

const createBaseFileInspector = (): InspectBaseFile => {
  const locate = createBaseLocator();

  return async (file) => {
    // An unresolved base cannot prove the file is new, unlike a missing file at a valid base.
    const base = await locate(file);
    if (!base) return;

    const result = await run(
      'git',
      ['cat-file', '-e', `${base.baseCommit}:${base.basePath}`],
      mountDir(base.mount),
    );

    return {
      baseRef: base.baseRef,
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
