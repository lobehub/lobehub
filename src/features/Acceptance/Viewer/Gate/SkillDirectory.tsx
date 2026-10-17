'use client';

import { createStaticStyles, cssVar, Flexbox, Highlighter, Markdown } from '@lobehub/ui';
import { memo, useMemo, useState } from 'react';

import Loading from '@/components/Loading/CircleLoading';
import {
  skillFileTree,
  skillVersionContent,
} from '@/features/AgentGoals/ProcessControl/BatchPlan/skillVersions';
import { getLanguage } from '@/features/AgentSkillDetail/ContentViewer';
import FileTree from '@/features/FileTree';
import { useClientDataSWR } from '@/libs/swr';
import { userSkillService } from '@/services/userSkill';
import { parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';

const SKILL_INDEX = 'SKILL.md';
const MARKDOWN_FILE = /\.mdx?$/i;

const styles = createStaticStyles(({ css }) => ({
  // Kept open, the tree stays beside the file being read while it scrolls.
  tree: css`
    position: sticky;
    inset-block-start: 0;

    overflow-y: auto;
    flex: none;
    align-self: flex-start;

    width: 240px;
    max-height: 480px;
    padding-block: 4px;
    padding-inline: 0 8px;
    border-inline-end: 1px solid ${cssVar.colorBorder};
  `,
  viewer: css`
    flex: 1;
    min-width: 0;
  `,
}));

interface SkillDirectoryProps {
  /** `SKILL.md` as the dossier froze it, read when the skill itself can't be. */
  fallbackContent: string;
  /** Whether the file tree is shown; folded, the viewer takes the full width. */
  filesOpen: boolean;
  /** The skill version under review: its `SKILL.md`, not whatever is latest. */
  revision: number;
  skillId: string;
}

/**
 * The plan skill as a directory: a plan that ships scripts or references is
 * several files, and the owner approving it should be able to read every one.
 * `SKILL.md` shows its body alone — the frontmatter is the library's, not the plan.
 */
const SkillDirectory = memo<SkillDirectoryProps>(
  ({ fallbackContent, filesOpen, revision, skillId }) => {
    const [selectedFile, setSelectedFile] = useState(SKILL_INDEX);
    const { data: skill, isLoading } = useClientDataSWR(['goal-gate-plan-skill', skillId], () =>
      userSkillService.get(skillId),
    );
    const files = useMemo(() => skill?.files ?? [], [skill]);
    const resourceTree = useMemo(() => skillFileTree(files), [files]);
    const contentMap = useMemo(
      () => Object.fromEntries(files.map((file) => [file.path, file.content])),
      [files],
    );

    if (isLoading) return <Loading />;

    const index = skillVersionContent(skill?.versions, revision) ?? fallbackContent;
    // Folded, the tree can't switch files: the viewer is back on `SKILL.md`.
    const shown = filesOpen ? selectedFile : SKILL_INDEX;

    const content = shown === SKILL_INDEX ? index : contentMap[shown];

    return (
      <Flexbox horizontal gap={20}>
        {filesOpen && (
          <div className={styles.tree}>
            <FileTree
              resourceTree={resourceTree}
              rootFile={{ label: SKILL_INDEX, path: SKILL_INDEX }}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
            />
          </div>
        )}
        <div className={styles.viewer}>
          {/* Flush with the section, no frame of their own: documents as prose, the rest as code. */}
          {MARKDOWN_FILE.test(shown) ? (
            <Markdown fontSize={14} key={shown} variant={'chat'}>
              {parseSkillMarkdownFrontmatter(content).body}
            </Markdown>
          ) : (
            <Highlighter key={shown} language={getLanguage(shown)} variant={'filled'}>
              {content ?? ''}
            </Highlighter>
          )}
        </div>
      </Flexbox>
    );
  },
);

SkillDirectory.displayName = 'GateSkillDirectory';

export default SkillDirectory;
