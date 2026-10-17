import { useEditor } from '@lobehub/editor/react';
import { ActionIcon, createStaticStyles, cssVar, cx, Flexbox, Text } from '@lobehub/ui';
import { PanelRightCloseIcon, PanelRightOpenIcon } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Loading from '@/components/Loading/CircleLoading';
import ContentViewer from '@/features/AgentSkillDetail/ContentViewer';
import { EditorCanvas } from '@/features/EditorCanvas';
import FileTree from '@/features/FileTree';
import SkillFrontmatterCard from '@/features/Portal/Document/SkillFrontmatterCard';
import { parseSkillMarkdownFrontmatter } from '@/utils/skillMarkdown';

import type { GoalGraphView } from '../goalGraphViewModel';
import type { BatchModel, BatchRound } from '../Graph/batchModel';
import { usePlanVersions, usePlanVersionSelection } from './planVersion';
import { skillFileTree } from './skillVersions';

/**
 * A batch's plan, opened from its node, read the way the product reads a
 * skill document: its frontmatter card (folded — the plan is what one comes
 * to read), then the selected file of the skill on the left — `SKILL.md` on
 * the same canvas documents render on, read-only since a version is a record
 * of a round — and the skill's files on the right.
 * Which version shows, and comparing two, live in the panel's header
 * (`PlanHeaderActions`), out of the document.
 */

const SKILL_INDEX = 'SKILL.md';

const styles = createStaticStyles(({ css }) => ({
  files: css`
    overflow-y: auto;
    display: flex;
    flex: none;
    flex-direction: column;

    width: 180px;
    padding: 8px;
    border-inline-start: 1px solid ${cssVar.colorBorderSecondary};
  `,
  filesFolded: css`
    width: auto;
    padding-inline: 4px;
  `,
  filesHead: css`
    padding-block: 2px 6px;
    padding-inline: 8px 0;
  `,
}));

interface PlanDetailProps {
  graph: GoalGraphView;
  model: BatchModel;
  round: BatchRound;
}

const PlanDetail = memo<PlanDetailProps>(({ graph, model, round }) => {
  const { t } = useTranslation('chat');
  const editor = useEditor();
  const [selectedFile, setSelectedFile] = useState(SKILL_INDEX);
  const [filesOpen, setFilesOpen] = useState(true);
  const { selected } = usePlanVersionSelection();
  const { files, isLoading, versions } = usePlanVersions(graph, model);
  const resourceTree = useMemo(() => skillFileTree(files), [files]);
  const contentMap = useMemo(
    () => Object.fromEntries(files.map((file) => [file.path, file.content])),
    [files],
  );

  if (isLoading) return <Loading />;

  const revision = selected ?? round.planVersion;
  const current = versions.find((version) => version.revision === revision);
  const forked = model.rounds.find((item) => item.planVersion === revision)?.forked;
  const { body, frontmatter } = parseSkillMarkdownFrontmatter(current?.content);

  return (
    <Flexbox data-plan-detail flex={1} style={{ minHeight: 0 }}>
      {(forked || frontmatter) && (
        <Flexbox paddingInline={16} style={{ flex: 'none' }}>
          {forked && (
            <Text fontSize={12} style={{ paddingBlockStart: 12 }} type={'secondary'}>
              {t('goalBatch.planPanel.forked')}
            </Text>
          )}
          {frontmatter && <SkillFrontmatterCard defaultCollapsed frontmatter={frontmatter} />}
        </Flexbox>
      )}
      <Flexbox horizontal flex={1} style={{ minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingBlockEnd: 24 }}>
          {selectedFile === SKILL_INDEX ? (
            <div style={{ paddingInline: 16 }}>
              <EditorCanvas
                editable={false}
                editor={editor}
                editorData={{ content: body }}
                entityId={`${model.planSkill?.id ?? model.batchId}:${revision}`}
                floatingToolbar={false}
              />
            </div>
          ) : (
            <ContentViewer contentMap={contentMap} key={selectedFile} selectedFile={selectedFile} />
          )}
        </div>
        {/* The skill's files: folds to a rail so the document can take the width. */}
        <div
          className={cx(styles.files, !filesOpen && styles.filesFolded)}
          data-plan-files={filesOpen ? 'open' : 'folded'}
        >
          {filesOpen ? (
            <>
              <Flexbox
                horizontal
                align={'center'}
                className={styles.filesHead}
                justify={'space-between'}
              >
                <Text fontSize={12} type={'secondary'} weight={500}>
                  {t('goalBatch.planPanel.files')}
                </Text>
                <ActionIcon
                  icon={PanelRightCloseIcon}
                  size={'small'}
                  title={t('goalBatch.planPanel.foldFiles')}
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
              icon={PanelRightOpenIcon}
              size={'small'}
              title={t('goalBatch.planPanel.unfoldFiles')}
              onClick={() => setFilesOpen(true)}
            />
          )}
        </div>
      </Flexbox>
    </Flexbox>
  );
});

PlanDetail.displayName = 'GoalBatchPlanDetail';

export default PlanDetail;
