'use client';

import { CodeDiff, CopyButton, Flexbox, ScrollShadow, TooltipGroup } from '@lobehub/ui';
import { ActionIcon } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { CheckCircle, FileText, Maximize2, Minimize2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

const COLLAPSED_MAX_HEIGHT = 280;
const INSPECTOR_CHECK_COLUMN = 24;

/**
 * Prompts are not files, so the "No newline at end of file" marker CodeDiff emits
 * for content without a trailing newline is pure noise. Worse, when only one side
 * ends with a newline the last line shows up as deleted + re-added. Normalising
 * both sides to end with exactly one newline keeps the diff about the words.
 */
const withTrailingNewline = (value: string) =>
  value === '' || value.endsWith('\n') ? value : `${value}\n`;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    width: 100%;
    min-width: 0;
    font-size: 13px;
  `,
  contentBox: css`
    overflow: hidden;

    width: 100%;
    min-width: 0;
    padding: 12px;
    border-inline-start: 3px solid ${cssVar.colorSuccess};

    background: ${cssVar.colorFillTertiary};
  `,
  diff: css`
    overflow: hidden;
    width: 100%;
    min-width: 0;
  `,
  diffPanel: css`
    border-radius: 0;
  `,
  fileIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextTertiary};
  `,
  promptContent: css`
    min-width: 0;

    font-size: 13px;
    line-height: 1.6;
    color: ${cssVar.colorText};
    word-break: break-word;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
  `,
  promptLabel: css`
    overflow: hidden;

    min-width: 0;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  statusIcon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 24px;
    height: 24px;
  `,
  statusRow: css`
    width: calc(100% - 12px);
    min-width: 0;
    margin-inline-start: 4px;
    color: ${cssVar.colorSuccess};
  `,
  statusText: css`
    overflow: hidden;

    min-width: 0;

    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
}));

export interface PromptDiffViewProps {
  /**
   * The prompt after the update. Empty string means the prompt was cleared.
   */
  newPrompt?: string;
  /**
   * The prompt before the update. `undefined` means the tool result predates
   * `previousPrompt` being recorded, in which case only the new prompt is shown.
   */
  previousPrompt?: string;
}

const PromptDiffView = memo<PromptDiffViewProps>(({ newPrompt = '', previousPrompt }) => {
  const { t } = useTranslation('plugin');
  const [expanded, setExpanded] = useState(false);

  const hasDiff = previousPrompt !== undefined && previousPrompt !== newPrompt;
  const isUnchanged = previousPrompt !== undefined && previousPrompt === newPrompt;
  const showPreview = !hasDiff && !isUnchanged && !!newPrompt;
  const showContent = hasDiff || showPreview;
  const canCopy = !!newPrompt;
  const contentMaxHeight = expanded ? undefined : COLLAPSED_MAX_HEIGHT;

  const statusKey = isUnchanged
    ? 'builtins.lobe-agent-builder.render.updatePrompt.unchanged'
    : newPrompt
      ? 'builtins.lobe-agent-builder.render.updatePrompt.updated'
      : 'builtins.lobe-agent-builder.render.updatePrompt.cleared';

  const actions = (canCopy || showContent) && (
    <TooltipGroup>
      <Flexbox horizontal align={'center'} gap={2}>
        {canCopy && (
          <CopyButton
            content={newPrompt}
            size={'small'}
            title={t('builtins.lobe-agent-builder.render.updatePrompt.copy')}
          />
        )}
        {showContent && (
          <ActionIcon
            icon={expanded ? Minimize2 : Maximize2}
            size={'small'}
            title={t(
              expanded
                ? 'builtins.lobe-agent-builder.render.updatePrompt.collapse'
                : 'builtins.lobe-agent-builder.render.updatePrompt.expand',
            )}
            onClick={() => setExpanded((value) => !value)}
          />
        )}
      </Flexbox>
    </TooltipGroup>
  );

  return (
    <Flexbox className={styles.container} gap={8}>
      <Flexbox
        horizontal
        align={'center'}
        className={styles.statusRow}
        distribution={'space-between'}
        gap={8}
      >
        <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
          <span className={styles.statusIcon}>
            <CheckCircle size={14} />
          </span>
          <span className={styles.statusText}>{t(statusKey)}</span>
        </Flexbox>
        {actions}
      </Flexbox>

      {hasDiff && (
        <ScrollShadow
          className={styles.diff}
          offset={12}
          size={12}
          style={{ maxHeight: contentMaxHeight }}
        >
          <CodeDiff
            className={styles.diffPanel}
            language={'markdown'}
            newContent={withTrailingNewline(newPrompt)}
            oldContent={withTrailingNewline(previousPrompt)}
            showHeader={false}
            variant={'borderless'}
            viewMode={'unified'}
          />
        </ScrollShadow>
      )}

      {showPreview && (
        <Flexbox className={styles.contentBox} gap={8}>
          <Flexbox horizontal align={'center'} gap={6}>
            <FileText className={styles.fileIcon} size={14} />
            <span className={styles.promptLabel}>
              {t('builtins.lobe-agent-builder.render.updatePrompt.newPrompt', {
                count: newPrompt.length,
              })}
            </span>
          </Flexbox>
          <ScrollShadow
            className={styles.promptContent}
            offset={12}
            size={12}
            style={{ maxHeight: contentMaxHeight }}
          >
            {newPrompt}
          </ScrollShadow>
        </Flexbox>
      )}
    </Flexbox>
  );
});

PromptDiffView.displayName = 'PromptDiffView';

export default PromptDiffView;
