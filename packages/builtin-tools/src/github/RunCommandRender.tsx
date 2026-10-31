'use client';

import type { BuiltinRenderProps } from '@lobechat/types';
import { Flexbox, Highlighter, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useMemo } from 'react';

import {
  getGithubOutput,
  type GithubRunCommandArgs,
  type GithubRunCommandState,
  normalizeGhCommand,
  tryParseJson,
} from './utils';

const styles = stylex.create({
  exitCode: { marginInlineStart: '8px', fontFamily: cssVar.fontFamilyCode, fontSize: '12px' },
  exitCodeError: { color: cssVar.colorError },
  exitCodeSuccess: { color: cssVar.colorSuccess },
  sectionLabel: { marginBlockEnd: '4px', fontSize: '12px', color: cssVar.colorTextSecondary },
});

const GithubRunCommandRender = memo<
  BuiltinRenderProps<GithubRunCommandArgs, GithubRunCommandState>
>(({ args, content, pluginState }) => {
  const rawCommand = args?.command || '';
  const normalized = normalizeGhCommand(rawCommand);

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
    <Flexbox gap={12}>
      {normalized && (
        <div>
          <Text className={stylex.props(styles.sectionLabel).className}>
            Command
            {success !== undefined && (
              <span
                className={`${stylex.props(styles.exitCode).className} ${
                  stylex.props(success ? styles.exitCodeSuccess : styles.exitCodeError).className
                }`}
              >
                exit {exitCode ?? (success ? 0 : 1)}
              </span>
            )}
          </Text>
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
          <Text className={stylex.props(styles.sectionLabel).className}>Output</Text>
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
          <Text
            className={stylex.props(styles.sectionLabel).className}
            style={{ color: cssVar.colorError }}
          >
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
  );
});

GithubRunCommandRender.displayName = 'GithubRunCommandRender';

export default GithubRunCommandRender;
