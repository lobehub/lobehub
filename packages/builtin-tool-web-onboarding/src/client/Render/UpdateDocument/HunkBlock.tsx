'use client';

import type { MarkdownPatchHunk } from '@lobechat/markdown-patch';
import { createStaticStyles } from 'antd-style';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  added: css`
    overflow: auto;

    max-height: 200px;
    margin: 0;
    padding-block: 6px;
    padding-inline: 10px;
    border-inline-start: 2px solid ${cssVar.colorSuccess};
    border-radius: 0 6px 6px 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorText};
    word-break: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorSuccessBg};
  `,
  block: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
  `,
  count: css`
    flex-shrink: 0;

    margin-inline-start: auto;

    font-size: 12px;
    font-weight: 400;
    color: ${cssVar.colorTextTertiary};
  `,
  label: css`
    display: flex;
    gap: 8px;
    align-items: center;

    font-size: 12px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  lineRange: css`
    padding-block: 1px;
    padding-inline: 6px;
    border-radius: 4px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 11px;
    color: ${cssVar.colorTextTertiary};

    background: ${cssVar.colorFillTertiary};
  `,
  removed: css`
    overflow: auto;

    max-height: 200px;
    margin: 0;
    padding-block: 6px;
    padding-inline: 10px;
    border-inline-start: 2px solid ${cssVar.colorError};
    border-radius: 0 6px 6px 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    line-height: 1.5;
    color: ${cssVar.colorTextSecondary};
    word-break: break-word;
    white-space: pre-wrap;

    background: ${cssVar.colorErrorBg};
  `,
}));

interface HunkBlockProps {
  countLabel?: string;
  hunk: MarkdownPatchHunk;
}

interface HunkContent {
  added?: string;
  labelKey:
    | 'builtins.lobe-web-onboarding.updateDocument.hunkMode.delete'
    | 'builtins.lobe-web-onboarding.updateDocument.hunkMode.deleteLines'
    | 'builtins.lobe-web-onboarding.updateDocument.hunkMode.insertAt'
    | 'builtins.lobe-web-onboarding.updateDocument.hunkMode.replace'
    | 'builtins.lobe-web-onboarding.updateDocument.hunkMode.replaceLines';
  lineRange?: string;
  removed?: string;
}

const resolveHunk = (hunk: MarkdownPatchHunk): HunkContent => {
  switch (hunk.mode) {
    case 'delete': {
      return {
        labelKey: 'builtins.lobe-web-onboarding.updateDocument.hunkMode.delete',
        removed: hunk.search,
      };
    }
    case 'deleteLines': {
      return {
        labelKey: 'builtins.lobe-web-onboarding.updateDocument.hunkMode.deleteLines',
        lineRange: `${hunk.startLine}–${hunk.endLine}`,
      };
    }
    case 'insertAt': {
      return {
        added: hunk.content,
        labelKey: 'builtins.lobe-web-onboarding.updateDocument.hunkMode.insertAt',
        lineRange: `L${hunk.line}`,
      };
    }
    case 'replaceLines': {
      return {
        added: hunk.content,
        labelKey: 'builtins.lobe-web-onboarding.updateDocument.hunkMode.replaceLines',
        lineRange: `${hunk.startLine}–${hunk.endLine}`,
      };
    }
    default: {
      // 'replace' or undefined — both shapes are MarkdownPatchReplaceHunk
      return {
        added: hunk.replace,
        labelKey: 'builtins.lobe-web-onboarding.updateDocument.hunkMode.replace',
        removed: hunk.search,
      };
    }
  }
};

const HunkBlock = memo<HunkBlockProps>(({ countLabel, hunk }) => {
  const { t } = useTranslation('plugin');
  const { added, labelKey, lineRange, removed } = resolveHunk(hunk);

  const blocks: ReactNode[] = [];
  if (removed)
    blocks.push(
      <pre className={styles.removed} key="removed">
        {removed}
      </pre>,
    );
  if (added)
    blocks.push(
      <pre className={styles.added} key="added">
        {added}
      </pre>,
    );

  return (
    <div className={styles.block}>
      <div className={styles.label}>
        <span>{t(labelKey)}</span>
        {lineRange && <span className={styles.lineRange}>{lineRange}</span>}
        {countLabel && <span className={styles.count}>{countLabel}</span>}
      </div>
      {blocks}
    </div>
  );
});

HunkBlock.displayName = 'HunkBlock';

export default HunkBlock;
