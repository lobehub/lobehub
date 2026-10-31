'use client';

import { Center, Flexbox, Highlighter, Icon, Markdown, Spin, Tabs } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CodeIcon, EyeIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';
import NotSupport from '../../NotSupport';

const styles = stylex.create({
  controls: {
    position: 'absolute',
    zIndex: 2,
    insetBlockStart: '8px',
    insetInlineEnd: '12px',
    padding: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    opacity: { 'default': 0.55, ':hover': 1 },
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
    backdropFilter: 'blur(8px)',
    boxShadow: cssVar.boxShadowTertiary,
    transition: 'opacity 150ms ease',
  },
  page: {
    position: 'relative',
    overflowX: 'hidden',
    overflowY: 'auto',
    width: '100%',
    height: '100%',
  },
});

type PreviewMode = 'render' | 'raw';

interface MarkdownViewerProps {
  fileId: string;
  url: string | null;
}

/**
 * Rendered markdown preview for cloud files (with a raw-source toggle) — the
 * FilePreview counterpart of the LocalFile portal's markdown pane. Plain code
 * files keep going through `Renderer/Code`.
 */
const MarkdownViewer = memo<MarkdownViewerProps>(({ url }) => {
  const { t } = useTranslation('file');
  const { error, fileData, loading, tooLarge } = useTextFileLoader(url);
  const [mode, setMode] = useState<PreviewMode>('render');

  if (!loading && fileData === null)
    return (
      <Flexbox>
        {error && <AsyncError error={error} variant={'block'} />}
        <NotSupport tooLarge={tooLarge} url={url} />
      </Flexbox>
    );

  if (loading || fileData === null)
    return (
      <Center height={'100%'} width={'100%'}>
        <Spin size="large" />
      </Center>
    );

  return (
    <Flexbox className={stylex.props(styles.page).className}>
      <Flexbox
        horizontal
        align={'center'}
        className={stylex.props(styles.controls).className}
        gap={4}
      >
        <Tabs
          activeKey={mode}
          size={'small'}
          items={[
            { icon: <Icon icon={EyeIcon} />, key: 'render', label: t('preview.render') },
            { icon: <Icon icon={CodeIcon} />, key: 'raw', label: t('preview.raw') },
          ]}
          onChange={(key) => setMode(key as PreviewMode)}
        />
      </Flexbox>
      {mode === 'render' ? (
        <Markdown style={{ paddingBlock: 16, paddingInline: 24 }}>{fileData}</Markdown>
      ) : (
        <Highlighter language={'markdown'} showLanguage={false} variant={'borderless'}>
          {fileData}
        </Highlighter>
      )}
    </Flexbox>
  );
});

export default MarkdownViewer;
