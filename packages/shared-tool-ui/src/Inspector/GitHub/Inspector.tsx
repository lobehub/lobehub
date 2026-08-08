'use client';

import type { BuiltinInspector, BuiltinInspectorProps } from '@lobechat/types';
import { createStaticStyles, cx } from 'antd-style';
import { GitBranch, Hash } from 'lucide-react';
import { memo } from 'react';

import { inspectorTextStyles, shinyTextStyles } from '../../styles';
import { parseGitHubToolName, staticGitHubLabelFor } from './labels';

const styles = createStaticStyles(({ css, cssVar }) => ({
  branchBadge: css`
    display: inline-flex;
    flex-shrink: 0;
    gap: 4px;
    align-items: center;

    min-width: 0;
    margin-inline-start: 6px;
    padding-block: 2px;
    padding-inline: 8px;
    border-radius: 999px;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorText};

    background: ${cssVar.colorFillQuaternary};
  `,
  branchBadgeText: css`
    overflow: hidden;
    max-width: 220px;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  chip: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    align-items: stretch;

    min-width: 0;
    margin-inline-start: 6px;
    border-radius: 999px;

    font-size: 12px;
    line-height: 18px;

    background: ${cssVar.colorFillTertiary};
  `,
  chipAction: css`
    flex-shrink: 0;
    padding-block: 2px;
    padding-inline: 10px;
    color: ${cssVar.colorText};
  `,
  chipDivider: css`
    flex-shrink: 0;
    align-self: stretch;
    width: 1px;
    background: ${cssVar.colorBorderSecondary};
  `,
  chipIcon: css`
    flex-shrink: 0;
    color: ${cssVar.colorTextDescription};
  `,
  chipKey: css`
    color: ${cssVar.colorTextDescription};
  `,
  chipValue: css`
    overflow: hidden;
    display: inline-flex;
    flex-shrink: 1;
    gap: 4px;
    align-items: center;

    min-width: 0;
    padding-block: 2px;
    padding-inline: 10px;

    font-family: ${cssVar.fontFamilyCode};
    color: ${cssVar.colorText};
  `,
  chipValueText: css`
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  icon: css`
    flex-shrink: 0;
    margin-inline-end: 6px;
    color: ${cssVar.colorTextDescription};
  `,
  productPrefix: css`
    flex-shrink: 0;

    margin-inline-end: 2px;

    font-size: 13px;
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const GitHubMark = memo<{ size?: number }>(({ size = 14 }) => (
  <svg
    aria-hidden="true"
    className={styles.icon}
    height={size}
    viewBox="0 0 98 96"
    width={size}
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M48.9 0C21.9 0 0 22 0 49.1c0 21.7 14 40.1 33.5 46.6 2.4.5 3.3-1.1 3.3-2.4 0-1.2-.1-5.2-.1-9.4-13.6 3-16.5-5.8-16.5-5.8-2.2-5.7-5.4-7.2-5.4-7.2-4.5-3.1.3-3 .3-3 4.9.3 7.5 5.1 7.5 5.1 4.4 7.5 11.5 5.3 14.3 4.1.4-3.2 1.7-5.3 3.1-6.6-10.9-1.2-22.3-5.5-22.3-24.3 0-5.4 1.9-9.8 5.1-13.2-.5-1.2-2.2-6.3.5-13 0 0 4.1-1.3 13.5 5 3.9-1.1 8.1-1.6 12.2-1.6s8.3.5 12.2 1.6c9.4-6.4 13.5-5 13.5-5 2.7 6.7 1 11.8.5 13 3.2 3.4 5.1 7.8 5.1 13.2 0 18.9-11.5 23.1-22.4 24.3 1.8 1.6 3.3 4.6 3.3 9.3 0 6.7-.1 12.1-.1 13.8 0 1.3.9 2.9 3.4 2.4C84 89.2 98 70.8 98 49.1 97.9 22 75.9 0 48.9 0Z"
      fill="currentColor"
    />
  </svg>
));
GitHubMark.displayName = 'GitHubMark';

interface Chip {
  iconType?: 'number';
  key?: string;
  value: string;
}

interface ChipResult {
  branch?: string;
  primary: Chip | null;
}

const truncate = (value: string, max = 80): string =>
  value.length > max ? `${value.slice(0, max - 1)}...` : value;

const readString = (value: unknown): string | undefined => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && value && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const key of ['full_name', 'name', 'login', 'id']) {
      const nested = readString(record[key]);
      if (nested) return nested;
    }
  }
};

const stringArg = (args: Record<string, unknown> | undefined, key: string): string | undefined =>
  readString(args?.[key]);

const pickRepo = (args: Record<string, unknown> | undefined): string | undefined => {
  if (!args) return;

  const direct =
    stringArg(args, 'repository_full_name') ||
    stringArg(args, 'full_name') ||
    stringArg(args, 'repository') ||
    stringArg(args, 'repo');
  if (direct) return direct;

  const owner = stringArg(args, 'owner');
  const name = stringArg(args, 'name');
  return owner && name ? `${owner}/${name}` : undefined;
};

const pickNumber = (args: Record<string, unknown> | undefined): string | undefined =>
  stringArg(args, 'pull_number') ||
  stringArg(args, 'pullNumber') ||
  stringArg(args, 'issue_number') ||
  stringArg(args, 'issueNumber') ||
  stringArg(args, 'number');

const pickBranch = (args: Record<string, unknown> | undefined): string | undefined => {
  if (!args) return;

  const head = stringArg(args, 'head') || stringArg(args, 'head_ref');
  const base = stringArg(args, 'base') || stringArg(args, 'base_ref');
  if (head && base) return `${head} -> ${base}`;

  return head || base || stringArg(args, 'branch') || stringArg(args, 'ref');
};

const pickPrimaryChip = (args: Record<string, unknown> | undefined): Chip | null => {
  if (!args) return null;

  const repo = pickRepo(args);
  if (repo) return { key: 'repo', value: truncate(repo, 72) };

  const number = pickNumber(args);
  if (number) return { iconType: 'number', value: `#${number}` };

  const title = stringArg(args, 'title') || stringArg(args, 'subject');
  if (title) return { value: truncate(title, 72) };

  const query = stringArg(args, 'query') || stringArg(args, 'q');
  if (query) return { key: 'query', value: truncate(query, 72) };

  const path = stringArg(args, 'path') || stringArg(args, 'file_path');
  if (path) return { key: 'path', value: truncate(path, 72) };

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.length > 0) {
      return { key, value: truncate(value, 72) };
    }
  }

  return null;
};

const pickChip = (args: Record<string, unknown> | undefined): ChipResult => ({
  branch: pickBranch(args),
  primary: pickPrimaryChip(args),
});

const GitHubInspectorImpl = memo<BuiltinInspectorProps<Record<string, unknown>>>(
  ({ apiName, args, partialArgs, isArgumentsStreaming, isLoading }) => {
    const effectiveArgs = args ?? partialArgs;
    const label = staticGitHubLabelFor(parseGitHubToolName(apiName));
    const { branch, primary } = pickChip(effectiveArgs);

    return (
      <div
        className={cx(
          inspectorTextStyles.root,
          (isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText,
        )}
      >
        <GitHubMark />
        <span className={styles.productPrefix}>GitHub</span>
        <span className={styles.chip}>
          <span className={styles.chipAction}>{label}</span>
          {primary && (
            <>
              <span className={styles.chipDivider} />
              <span className={styles.chipValue}>
                {primary.iconType === 'number' ? (
                  <Hash className={styles.chipIcon} size={12} />
                ) : (
                  primary.key && <span className={styles.chipKey}>{primary.key}:</span>
                )}
                <span className={styles.chipValueText}>{primary.value}</span>
              </span>
            </>
          )}
        </span>
        {branch && (
          <span className={styles.branchBadge} title={branch}>
            <GitBranch className={styles.chipIcon} size={12} />
            <span className={styles.branchBadgeText}>{branch}</span>
          </span>
        )}
      </div>
    );
  },
);
GitHubInspectorImpl.displayName = 'GitHubInspector';

export const GitHubInspector = GitHubInspectorImpl as unknown as BuiltinInspector;
