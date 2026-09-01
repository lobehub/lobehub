'use client';

import {
  createEditLocalFileInspector,
  createGlobLocalFilesInspector,
  createGrepContentInspector,
  createReadLocalFileInspector,
  createRunCommandInspector,
  createWriteLocalFileInspector,
} from '@lobechat/shared-tool-ui/inspectors';
import { RunCommandRender } from '@lobechat/shared-tool-ui/renders';
import {
  highlightTextStyles,
  inspectorTextStyles,
  shinyTextStyles,
} from '@lobechat/shared-tool-ui/styles';
import type { BuiltinInspector, BuiltinInspectorProps, BuiltinRenderProps } from '@lobechat/types';
import { CodeDiff, Highlighter, Markdown, Skeleton } from '@lobehub/ui';
import { cx } from 'antd-style';
import path from 'path-browserify-esm';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { countChangedLines, stripKimiLineNumbers } from './utils';

const KimiCodeApiName = {
  Agent: 'Agent',
  Bash: 'Bash',
  Edit: 'Edit',
  FetchURL: 'FetchURL',
  Glob: 'Glob',
  Grep: 'Grep',
  Read: 'Read',
  Skill: 'Skill',
  WebSearch: 'WebSearch',
  Write: 'Write',
} as const;

interface KimiLabelArgs {
  description?: string;
  query?: string;
  skill?: string;
  url?: string;
}

interface KimiEditArgs {
  new_string?: string;
  old_string?: string;
  path?: string;
  replace_all?: boolean;
}

interface KimiFileArgs {
  content?: string;
  path?: string;
}

interface EditState {
  linesAdded: number;
  linesDeleted: number;
  path: string;
  replacements: number;
}

interface KimiLabelInspectorProps extends BuiltinInspectorProps<KimiLabelArgs> {
  apiName: string;
  field: keyof KimiLabelArgs;
}

const KimiLabelInspector = memo<KimiLabelInspectorProps>(
  ({ apiName, args, field, isArgumentsStreaming, isLoading, partialArgs }) => {
    const { t } = useTranslation('plugin');
    const label = t(apiName as never);
    const value = args?.[field] || partialArgs?.[field] || '';

    return (
      <div className={inspectorTextStyles.root}>
        <span className={cx((isArgumentsStreaming || isLoading) && shinyTextStyles.shinyText)}>
          {label}
        </span>
        {value && (
          <>
            <span>: </span>
            <span className={highlightTextStyles.primary}>{value}</span>
          </>
        )}
      </div>
    );
  },
);
KimiLabelInspector.displayName = 'KimiCodeLabelInspector';

const createKimiLabelInspector = (apiName: string, field: keyof KimiLabelArgs) => {
  const Inspector = memo<BuiltinInspectorProps<KimiLabelArgs>>((props) => (
    <KimiLabelInspector {...props} apiName={apiName} field={field} />
  ));
  Inspector.displayName = `KimiCode${apiName}Inspector`;
  return Inspector;
};

const SharedEditInspector = createEditLocalFileInspector(KimiCodeApiName.Edit);

const EditInspector = memo<BuiltinInspectorProps<KimiEditArgs, EditState>>(
  ({ args, partialArgs, pluginState, ...rest }) => {
    const mappedArgs = {
      path: args?.path,
      replace: args?.new_string,
      search: args?.old_string,
    };
    const mappedPartialArgs = {
      path: partialArgs?.path,
      replace: partialArgs?.new_string,
      search: partialArgs?.old_string,
    };
    const synthesizedState = useMemo<EditState | undefined>(() => {
      if (pluginState) return pluginState;
      if (!args?.old_string && !args?.new_string) return;

      return {
        ...countChangedLines(args.old_string ?? '', args.new_string ?? ''),
        path: args.path ?? '',
        replacements: args.replace_all ? 0 : 1,
      };
    }, [args, pluginState]);

    return (
      <SharedEditInspector
        {...rest}
        args={mappedArgs}
        partialArgs={mappedPartialArgs}
        pluginState={synthesizedState}
      />
    );
  },
);
EditInspector.displayName = 'KimiCodeEditInspector';

const TextResult = memo<BuiltinRenderProps>(({ content }) => {
  if (!content) return null;

  return (
    <Highlighter
      wrap
      language="text"
      showLanguage={false}
      style={{ maxHeight: 240, overflow: 'auto' }}
      variant="borderless"
    >
      {content}
    </Highlighter>
  );
});
TextResult.displayName = 'KimiCodeTextResult';

const MarkdownResult = memo<BuiltinRenderProps>(({ content }) => {
  if (!content) return null;

  return (
    <Markdown style={{ maxHeight: 320, overflow: 'auto' }} variant="chat">
      {content}
    </Markdown>
  );
});
MarkdownResult.displayName = 'KimiCodeMarkdownResult';

const ReadRender = memo<BuiltinRenderProps<KimiFileArgs>>(({ args, content }) => {
  const filePath = args?.path ?? '';
  const source = useMemo(() => stripKimiLineNumbers(content ?? ''), [content]);

  if (!source) return null;

  return (
    <Highlighter
      wrap
      language={path.extname(filePath).slice(1).toLowerCase() || 'text'}
      showLanguage={false}
      style={{ maxHeight: 240, overflow: 'auto' }}
      variant="borderless"
    >
      {source}
    </Highlighter>
  );
});
ReadRender.displayName = 'KimiCodeReadRender';

const WriteRender = memo<BuiltinRenderProps<KimiFileArgs>>(({ args }) => {
  if (!args) return <Skeleton active />;
  if (!args.content) return null;

  const extension = path
    .extname(args.path ?? '')
    .slice(1)
    .toLowerCase();
  if (extension === 'md' || extension === 'mdx') {
    return (
      <Markdown style={{ maxHeight: 240, overflow: 'auto' }} variant="chat">
        {args.content}
      </Markdown>
    );
  }

  return (
    <Highlighter
      wrap
      language={extension || 'text'}
      showLanguage={false}
      style={{ maxHeight: 240, overflow: 'auto' }}
      variant="borderless"
    >
      {args.content}
    </Highlighter>
  );
});
WriteRender.displayName = 'KimiCodeWriteRender';

const EditRender = memo<BuiltinRenderProps<KimiEditArgs>>(({ args }) => {
  if (!args) return <Skeleton active />;

  const filePath = args.path ?? '';
  return (
    <CodeDiff
      fileName={path.basename(filePath) || filePath}
      language={path.extname(filePath).slice(1).toLowerCase() || undefined}
      newContent={args.new_string ?? ''}
      oldContent={args.old_string ?? ''}
      showHeader={!!filePath}
      variant="borderless"
      viewMode="unified"
    />
  );
});
EditRender.displayName = 'KimiCodeEditRender';

export const KimiCodeInspectors: Record<string, BuiltinInspector> = {
  [KimiCodeApiName.Agent]: createKimiLabelInspector(
    KimiCodeApiName.Agent,
    'description',
  ) as BuiltinInspector,
  [KimiCodeApiName.Bash]: createRunCommandInspector(KimiCodeApiName.Bash) as BuiltinInspector,
  [KimiCodeApiName.Edit]: EditInspector as BuiltinInspector,
  [KimiCodeApiName.FetchURL]: createKimiLabelInspector(
    KimiCodeApiName.FetchURL,
    'url',
  ) as BuiltinInspector,
  [KimiCodeApiName.Glob]: createGlobLocalFilesInspector(KimiCodeApiName.Glob) as BuiltinInspector,
  [KimiCodeApiName.Grep]: createGrepContentInspector({
    noResultsKey: 'No results',
    translationKey: KimiCodeApiName.Grep,
  }) as BuiltinInspector,
  [KimiCodeApiName.Read]: createReadLocalFileInspector(KimiCodeApiName.Read) as BuiltinInspector,
  [KimiCodeApiName.Skill]: createKimiLabelInspector(
    KimiCodeApiName.Skill,
    'skill',
  ) as BuiltinInspector,
  [KimiCodeApiName.WebSearch]: createKimiLabelInspector(
    KimiCodeApiName.WebSearch,
    'query',
  ) as BuiltinInspector,
  [KimiCodeApiName.Write]: createWriteLocalFileInspector(KimiCodeApiName.Write) as BuiltinInspector,
};

export const KimiCodeRenders = {
  [KimiCodeApiName.Agent]: TextResult,
  [KimiCodeApiName.Bash]: RunCommandRender,
  [KimiCodeApiName.Edit]: EditRender,
  [KimiCodeApiName.FetchURL]: MarkdownResult,
  [KimiCodeApiName.Glob]: TextResult,
  [KimiCodeApiName.Grep]: TextResult,
  [KimiCodeApiName.Read]: ReadRender,
  [KimiCodeApiName.Skill]: TextResult,
  [KimiCodeApiName.WebSearch]: TextResult,
  [KimiCodeApiName.Write]: WriteRender,
};
