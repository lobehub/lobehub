'use client';

import { downloadFile } from '@lobechat/utils/client/downloadFile';
import { terminalTextFromStream } from '@lobechat/utils/verify/terminalEvidence';
import { ActionIcon, CopyButton, Input, Spin } from '@lobehub/ui';
import { Download, Search } from 'lucide-react';
import { Fragment, memo, type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useTextFileLoader } from '@/features/FileViewer/hooks/useTextFileLoader';

import {
  type PipeOutputSource,
  searchTerminalLines,
  splitTerminalLines,
  type TerminalTextSource,
  type TerminalTextView,
} from './model';
import { styles } from './styles';
import { castPlainText } from './timeline';
import { useAsciicast } from './useAsciicast';

const SEARCH_LINE_LIMIT = 2000;

type LoadedText =
  | { status: 'error' }
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'tooLarge' };

/** Resolve a view's source to display text. Hooks run unconditionally; a null URL idles them. */
const useViewText = (source: TerminalTextSource | undefined, plain: boolean): LoadedText => {
  const file = useTextFileLoader(source?.kind === 'url' ? source.url : null);
  const cast = useAsciicast(source?.kind === 'cast' ? source.url : null);
  const castText = useMemo(() => (cast.cast ? castPlainText(cast.cast.events) : null), [cast.cast]);
  const fileText = useMemo(
    () =>
      file.fileData === null ? null : plain ? terminalTextFromStream(file.fileData) : file.fileData,
    [file.fileData, plain],
  );

  switch (source?.kind) {
    case 'empty': {
      return { status: 'ready', text: '' };
    }
    case 'inline': {
      return { status: 'ready', text: source.text };
    }
    case 'url': {
      if (file.loading) return { status: 'loading' };
      if (file.tooLarge) return { status: 'tooLarge' };
      return fileText === null ? { status: 'error' } : { status: 'ready', text: fileText };
    }
    case 'cast': {
      if (cast.loading) return { status: 'loading' };
      if (cast.error?.kind === 'tooLarge') return { status: 'tooLarge' };
      return castText === null ? { status: 'error' } : { status: 'ready', text: castText };
    }
    default: {
      return { status: 'error' };
    }
  }
};

const downloadText = (text: string, fileName: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoking in the same task can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/** Matched substrings wrapped in <mark>, the rest left as text. */
const highlight = (text: string, ranges: [number, number][], className: string) => {
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark className={className} key={index}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
};

/**
 * One static text view of a terminal evidence: line-numbered, searchable,
 * copyable, downloadable, and bounded in height so a long log scrolls inside
 * the card instead of drowning the check list.
 */
const TerminalTextPanel = memo<{
  download?: { onClick: () => void; title: string };
  fromRecording?: boolean;
  loaded: LoadedText;
}>(({ download, fromRecording, loaded }) => {
  const { t } = useTranslation('verify');
  const [query, setQuery] = useState('');
  const text = loaded.status === 'ready' ? loaded.text : '';
  const lines = useMemo(() => splitTerminalLines(text), [text]);
  const search = useMemo(
    () => searchTerminalLines(text, query.trim(), SEARCH_LINE_LIMIT),
    [text, query],
  );
  const searching = query.trim().length > 0;
  const toolbar = (
    <div className={styles.toolbar}>
      <Input
        allowClear
        aria-label={t('report.terminal.search.placeholder')}
        disabled={loaded.status !== 'ready' || text.length === 0}
        placeholder={t('report.terminal.search.placeholder')}
        prefix={<Search size={14} />}
        size={'small'}
        style={{ maxWidth: 280 }}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <span style={{ alignItems: 'center', display: 'flex', gap: 8 }}>
        <span className={styles.hint}>
          {searching
            ? search.matchCount > 0
              ? t('report.terminal.search.count', { count: search.matchCount })
              : t('report.terminal.search.none')
            : loaded.status === 'ready' && text.length > 0
              ? t('report.terminal.output.lines', { count: lines.length })
              : null}
        </span>
        {loaded.status === 'ready' && text.length > 0 && (
          <CopyButton content={text} size={'small'} title={t('report.terminal.copy')} />
        )}
        {download && (
          <ActionIcon
            icon={Download}
            size={'small'}
            title={download.title}
            onClick={download.onClick}
          />
        )}
      </span>
    </div>
  );

  let body: ReactNode;
  if (loaded.status === 'loading')
    body = (
      <div className={styles.outputState}>
        <Spin size={'large'} />
      </div>
    );
  else if (loaded.status === 'tooLarge')
    body = <div className={styles.outputState}>{t('report.terminal.output.tooLarge')}</div>;
  else if (loaded.status === 'error')
    body = <div className={styles.outputState}>{t('report.terminal.output.loadFailed')}</div>;
  else if (text.length === 0)
    body = <div className={styles.outputState}>{t('report.terminal.output.empty')}</div>;
  else if (searching && search.matchCount === 0)
    body = <div className={styles.outputState}>{t('report.terminal.search.none')}</div>;
  else
    body = (
      <div className={styles.outputBox}>
        <div className={styles.outputGrid}>
          <pre aria-hidden className={styles.gutter}>
            {searching
              ? search.lines.map((match) => match.line).join('\n')
              : lines.map((_, index) => index + 1).join('\n')}
          </pre>
          <pre className={styles.lines}>
            {searching
              ? search.lines.map((match, index) => (
                  <Fragment key={match.line}>
                    {index > 0 && '\n'}
                    {highlight(match.text, match.ranges, styles.match)}
                  </Fragment>
                ))
              : lines.join('\n')}
          </pre>
        </div>
      </div>
    );

  return (
    <>
      {toolbar}
      {body}
      {searching && search.matchedLineCount > search.lines.length && (
        <span className={styles.hint}>
          {t('report.terminal.search.capped', { count: search.lines.length })}
        </span>
      )}
      {fromRecording && loaded.status === 'ready' && (
        <span className={styles.hint}>{t('report.terminal.output.fromRecording')}</span>
      )}
    </>
  );
});

TerminalTextPanel.displayName = 'TerminalTextPanel';

const FileTerminalOutput = ({
  downloadName,
  plain,
  source,
}: {
  downloadName: string;
  plain: boolean;
  source: TerminalTextSource;
}) => {
  const { t } = useTranslation('verify');
  const loaded = useViewText(source, plain);
  const fromRecording = source.kind === 'cast';
  const onDownload = () => {
    if (source.kind === 'url') void downloadFile(source.url, downloadName);
    else if (source.kind === 'cast')
      void downloadFile(source.url, downloadName.replace(/\.\w+$/, '') + '.cast');
    else if (source.kind === 'inline') downloadText(source.text, downloadName);
  };

  return (
    <TerminalTextPanel
      fromRecording={fromRecording}
      loaded={loaded}
      download={
        source.kind === 'empty'
          ? undefined
          : {
              onClick: onDownload,
              title: t(
                fromRecording ? 'report.terminal.downloadRecording' : 'report.terminal.download',
              ),
            }
      }
    />
  );
};

const PipeTerminalOutput = ({
  downloadName,
  source,
}: {
  downloadName: string;
  source: PipeOutputSource;
}) => {
  const { t } = useTranslation('verify');
  const stdout = useViewText(source.stdout, true);
  const stderr = useViewText(source.stderr, true);
  const { transcriptUrl } = source;

  const section = (stream: 'stdout' | 'stderr', result: LoadedText) => {
    const label = t(`report.terminal.view.${stream}`);
    if (result.status === 'ready' && result.text.length > 0)
      return `--- ${label} ---\n${result.text}`;

    const status =
      result.status === 'ready'
        ? t('report.terminal.output.empty')
        : result.status === 'tooLarge'
          ? t('report.terminal.output.streamTooLarge')
          : t('report.terminal.output.streamUnavailable');
    return `--- ${label}: ${status} ---`;
  };

  let loaded: LoadedText = { status: 'loading' };
  if (stdout.status !== 'loading' && stderr.status !== 'loading') {
    const command = source.command ?? t('report.terminal.commandUnknown');
    const standardOutput = section('stdout', stdout);
    const separator = standardOutput.endsWith('\n') ? '' : '\n';
    loaded = {
      status: 'ready',
      text: `$ ${command}\n${standardOutput}${separator}${section('stderr', stderr)}`,
    };
  }

  return (
    <TerminalTextPanel
      loaded={loaded}
      download={
        transcriptUrl
          ? {
              onClick: () => void downloadFile(transcriptUrl, downloadName),
              title: t('report.terminal.downloadTranscript'),
            }
          : undefined
      }
    />
  );
};

export const TerminalOutput = memo<{ downloadName: string; view: TerminalTextView }>(
  ({ downloadName, view: { plain, source } }) =>
    source.kind === 'pipe' ? (
      <PipeTerminalOutput downloadName={downloadName} source={source} />
    ) : (
      <FileTerminalOutput downloadName={downloadName} plain={plain} source={source} />
    ),
);

TerminalOutput.displayName = 'TerminalOutput';
