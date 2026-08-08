'use client';

import { Center, Flexbox, Highlighter, Icon, Markdown } from '@lobehub/ui';
import { Tabs } from '@lobehub/ui/base-ui';
import { createStaticStyles, cssVar } from 'antd-style';
import { CodeIcon, EyeIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import NeuralNetworkLoading from '@/components/NeuralNetworkLoading';

import { useTextFileLoader } from '../../hooks/useTextFileLoader';

const styles = createStaticStyles(({ css }) => ({
  // Same floating-controls treatment as the LocalFile portal's text preview, so
  // the render/raw toggle reads identically across both file-preview surfaces.
  controls: css`
    position: absolute;
    z-index: 2;
    inset-block-start: 8px;
    inset-inline-end: 12px;

    padding: 4px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    opacity: 0.55;
    background: ${cssVar.colorBgElevated};
    backdrop-filter: blur(8px);
    box-shadow: ${cssVar.boxShadowTertiary};

    transition: opacity 150ms ease;

    &:hover {
      opacity: 1;
    }
  `,
  page: css`
    position: relative;
    overflow: hidden auto;
    width: 100%;
    height: 100%;
  `,
}));

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
  const { fileData, loading } = useTextFileLoader(url);
  const [mode, setMode] = useState<PreviewMode>('render');

  if (loading || fileData === null)
    return (
      <Center height={'100%'} width={'100%'}>
        <NeuralNetworkLoading size={36} />
      </Center>
    );

  return (
    <Flexbox className={styles.page}>
      <Flexbox horizontal align={'center'} className={styles.controls} gap={4}>
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
