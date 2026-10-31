'use client';

import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, Flexbox, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import {
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ContentViewer from '@/features/AgentSkillDetail/ContentViewer';
import { EditorCanvas } from '@/features/EditorCanvas';
import FileTree from '@/features/FileTree';
import SkillFrontmatterCard from '@/features/Portal/Document/SkillFrontmatterCard';
import { parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';

import { skillFileTree } from './skillFileTree';

const SKILL_INDEX = 'SKILL.md';

const styles = stylex.create({
  body: {
    flex: '1',
    minWidth: 0,
    overflowY: 'auto',
    paddingBlockEnd: 24,
  },
  files: {
    display: 'flex',
    flex: 'none',
    flexDirection: 'column',
    overflowY: 'auto',
    padding: 8,
    width: 180,
  },
  filesAtEnd: {
    borderInlineStartColor: cssVar.colorBorderSecondary,
    borderInlineStartStyle: 'solid',
    borderInlineStartWidth: 1,
  },
  filesAtStart: {
    borderInlineEndColor: cssVar.colorBorderSecondary,
    borderInlineEndStyle: 'solid',
    borderInlineEndWidth: 1,
  },
  filesFolded: {
    paddingInline: 4,
    width: 'auto',
  },
  filesHead: {
    paddingBlockEnd: 6,
    paddingBlockStart: 2,
    paddingInlineEnd: 0,
    paddingInlineStart: 8,
  },
  index: {
    paddingInline: 16,
  },
});

export interface SkillViewerProps {
  /** The skill's `SKILL.md`, frontmatter included. */
  content?: string;
  /** Identifies what the canvas shows, e.g. a skill id and its revision. */
  entityId: string;
  /**
   * The skill's other files, keyed by path. Passed, a rail lists them beside
   * `SKILL.md`; left out, the skill reads as its `SKILL.md` alone.
   */
  files?: readonly { content: string; path: string }[];
  /**
   * Which side the file tree sits on. At the start it runs the full height
   * beside the selected file, frontmatter included, the way a file browser
   * reads; at the end it is a rail beside the document. Defaults to the end.
   */
  filesPosition?: 'end' | 'start';
  /** A line above the frontmatter card, e.g. how this version came about. */
  notice?: ReactNode;
}

/**
 * A skill read the way the product reads a skill document: its frontmatter
 * card (folded — the instructions are what one comes to read), then the
 * selected file — `SKILL.md` on the same canvas documents render on,
 * read-only — and, when files are passed, the skill's file tree beside it.
 *
 * The caller loads the skill; this only presents it.
 */
const SkillViewer = ({
  content,
  entityId,
  files,
  filesPosition = 'end',
  notice,
}: SkillViewerProps) => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const [selectedFile, setSelectedFile] = useState(SKILL_INDEX);
  const [filesOpen, setFilesOpen] = useState(true);
  const resourceTree = useMemo(() => skillFileTree(files), [files]);
  const contentMap = useMemo(
    () => Object.fromEntries((files ?? []).map((file) => [file.path, file.content])),
    [files],
  );

  const { body, frontmatter } = parseSkillMarkdownFrontmatter(content);

  const atStart = filesPosition === 'start';

  const intro = (notice || frontmatter) && (
    <Flexbox paddingInline={16} style={{ flex: 'none' }}>
      {notice}
      {frontmatter && <SkillFrontmatterCard defaultCollapsed frontmatter={frontmatter} />}
    </Flexbox>
  );

  // The skill's files: folds to a rail so the document can take the width.
  const fileTree = files && (
    <div
      data-skill-files={filesOpen ? 'open' : 'folded'}
      {...stylex.props(
        styles.files,
        atStart ? styles.filesAtStart : styles.filesAtEnd,
        !filesOpen && styles.filesFolded,
      )}
    >
      {filesOpen ? (
        <>
          <Flexbox
            horizontal
            align={'center'}
            justify={'space-between'}
            {...stylex.props(styles.filesHead)}
          >
            <Text fontSize={12} type={'secondary'} weight={500}>
              {t('skillViewer.files')}
            </Text>
            <ActionIcon
              icon={atStart ? PanelLeftCloseIcon : PanelRightCloseIcon}
              size={'small'}
              title={t('skillViewer.foldFiles')}
              onClick={() => setFilesOpen(false)}
            />
          </Flexbox>
          <FileTree
            resourceTree={resourceTree}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </>
      ) : (
        <ActionIcon
          icon={atStart ? PanelLeftOpenIcon : PanelRightOpenIcon}
          size={'small'}
          title={t('skillViewer.unfoldFiles')}
          onClick={() => setFilesOpen(true)}
        />
      )}
    </div>
  );

  return (
    <Flexbox data-skill-viewer flex={1} style={{ minHeight: 0 }}>
      {!atStart && intro}
      <Flexbox horizontal flex={1} style={{ minHeight: 0 }}>
        {atStart && fileTree}
        <div {...stylex.props(styles.body)}>
          {atStart && intro}
          {selectedFile === SKILL_INDEX ? (
            <div {...stylex.props(styles.index)}>
              <EditorCanvas
                editable={false}
                editor={editor}
                editorData={{ content: body }}
                entityId={entityId}
                floatingToolbar={false}
              />
            </div>
          ) : (
            <ContentViewer contentMap={contentMap} key={selectedFile} selectedFile={selectedFile} />
          )}
        </div>
        {!atStart && fileTree}
      </Flexbox>
    </Flexbox>
  );
};

export default SkillViewer;
