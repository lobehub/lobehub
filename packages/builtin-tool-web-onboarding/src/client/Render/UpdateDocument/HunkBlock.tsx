'use client';

import type { MarkdownPatchHunk } from '@lobechat/markdown-patch';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import type { ReactNode } from 'react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  added: {
    overflow: 'auto',
    maxHeight: '200px',
    margin: '0',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorSuccess,
    borderTopLeftRadius: '0',
    borderTopRightRadius: '6px',
    borderBottomRightRadius: '6px',
    borderBottomLeftRadius: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorText,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    background: cssVar.colorSuccessBg,
  },
  block: { display: 'flex', flexDirection: 'column', gap: '6px' },
  count: {
    flexShrink: 0,
    marginInlineStart: 'auto',
    fontSize: '12px',
    fontWeight: 400,
    color: cssVar.colorTextTertiary,
  },
  label: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  lineRange: {
    paddingBlock: '1px',
    paddingInline: '6px',
    borderRadius: '4px',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '11px',
    color: cssVar.colorTextTertiary,
    background: cssVar.colorFillTertiary,
  },
  removed: {
    overflow: 'auto',
    maxHeight: '200px',
    margin: '0',
    paddingBlock: '6px',
    paddingInline: '10px',
    borderInlineStartWidth: '2px',
    borderInlineStartStyle: 'solid',
    borderInlineStartColor: cssVar.colorError,
    borderTopLeftRadius: '0',
    borderTopRightRadius: '6px',
    borderBottomRightRadius: '6px',
    borderBottomLeftRadius: '0',
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    lineHeight: 1.5,
    color: cssVar.colorTextSecondary,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    background: cssVar.colorErrorBg,
  },
});

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
      <pre {...stylex.props(styles.removed)} key="removed">
        {removed}
      </pre>,
    );
  if (added)
    blocks.push(
      <pre {...stylex.props(styles.added)} key="added">
        {added}
      </pre>,
    );

  return (
    <div {...stylex.props(styles.block)}>
      <div {...stylex.props(styles.label)}>
        <span>{t(labelKey)}</span>
        {lineRange && <span {...stylex.props(styles.lineRange)}>{lineRange}</span>}
        {countLabel && <span {...stylex.props(styles.count)}>{countLabel}</span>}
      </div>
      {blocks}
    </div>
  );
});

HunkBlock.displayName = 'HunkBlock';

export default HunkBlock;
