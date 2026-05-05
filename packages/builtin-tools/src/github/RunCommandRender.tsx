'use client';

import { ToolResultCard } from '@lobechat/shared-tool-ui/components';
import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { GitBranch } from 'lucide-react';
import { memo, useMemo } from 'react';

import {
  getGhSubcommand,
  getGithubOutput,
  type GithubRunCommandArgs,
  type GithubRunCommandState,
  normalizeGhCommand,
  tryParseJson,
} from './utils';

const styles = createStaticStyles(({ css, cssVar }) => ({
  exitCode: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
  `,
  exitCodeError: css`
    color: ${cssVar.colorError};
  `,
  exitCodeSuccess: css`
    color: ${cssVar.colorSuccess};
  `,
  ghPrefix: css`
    flex-shrink: 0;
    font-family: ${cssVar.fontFamilyCode};
    font-size: 12px;
    color: ${cssVar.colorTextDescription};
  `,
  headerCommand: css`
    overflow: hidden;
    flex: 1 1 auto;

    min-width: 0;

    font-family: ${cssVar.fontFamilyCode};
    font-size: 13px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  headerRow: css`
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    min-width: 0;
  `,
  sectionLabel: css`
    margin-block-end: 4px;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const GithubRunCommandRender = memo<
  BuiltinRenderProps<GithubRunCommandArgs, GithubRunCommandState>
>(({ args, content, pluginState }) => {
  const rawCommand = args?.command || '';
  const description = args?.description || '';
  const normalized = normalizeGhCommand(rawCommand);
  const subcommand = getGhSubcommand(rawCommand);
  const headerLabel = description || subcommand || normalized || 'command';

  const output = getGithubOutput(pluginState, content);
  const stderr = pluginState?.stderr || '';
  const exitCode = pluginState?.exitCode;
  const success = pluginState?.success ?? (exitCode === undefined ? undefined : exitCode === 0);

  const { language: outputLanguage, body: outputBody } = useMemo(() => {
    const parsed = tryParseJson(output);
    if (parsed !== undefined) {
      return { body: JSON.stringify(parsed, null, 2), language: 'json' as const };
    }
    return { body: output, language: 'text' as const };
  }, [output]);

  if (!normalized && !output && !stderr) return null;

  return (
    <ToolResultCard
      wrapHeader
      icon={GitBranch}
      header={
        <Flexbox horizontal align={'center'} className={styles.headerRow} wrap={'wrap'}>
          <span className={styles.ghPrefix}>gh</span>
          <span className={styles.headerCommand}>{headerLabel}</span>
          {success !== undefined && (
            <span
              className={`${styles.exitCode} ${
                success ? styles.exitCodeSuccess : styles.exitCodeError
              }`}
            >
              exit {exitCode ?? (success ? 0 : 1)}
            </span>
          )}
        </Flexbox>
      }
    >
      <Flexbox gap={12}>
        {normalized && (
          <div>
            <Text className={styles.sectionLabel}>Command</Text>
            <Highlighter
              wrap
              language={'sh'}
              showLanguage={false}
              style={{ maxHeight: 160, overflow: 'auto', paddingInline: 8 }}
              variant={'outlined'}
            >
              {`gh ${normalized}`}
            </Highlighter>
          </div>
        )}
        {outputBody && (
          <div>
            <Text className={styles.sectionLabel}>Output</Text>
            <Highlighter
              wrap
              language={outputLanguage}
              showLanguage={outputLanguage === 'json'}
              style={{ maxHeight: 360, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {outputBody}
            </Highlighter>
          </div>
        )}
        {stderr && (
          <div>
            <Text className={styles.sectionLabel} style={{ color: cssVar.colorError }}>
              Stderr
            </Text>
            <Highlighter
              wrap
              language={'text'}
              showLanguage={false}
              style={{ maxHeight: 200, overflow: 'auto', paddingInline: 8 }}
              variant={'filled'}
            >
              {stderr}
            </Highlighter>
          </div>
        )}
      </Flexbox>
    </ToolResultCard>
  );
});

GithubRunCommandRender.displayName = 'GithubRunCommandRender';

export default GithubRunCommandRender;
