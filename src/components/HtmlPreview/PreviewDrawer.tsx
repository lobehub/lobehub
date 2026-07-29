import { TITLE_BAR_HEIGHT } from '@lobechat/desktop-bridge';
import { exportFile } from '@lobechat/utils/client';
import { Block, Flexbox, Highlighter, HtmlPreview } from '@lobehub/ui';
import { Button, Tabs } from '@lobehub/ui/base-ui';
import { Drawer } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Code2, Download, Eye } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isDesktop } from '@/const/version';

const styles = createStaticStyles(({ css }) => ({
  container: css`
    height: 100%;
  `,
}));

const hideHtmlPreviewActions = () => null;

interface HtmlPreviewDrawerProps {
  content: string;
  onClose: () => void;
  open: boolean;
}

const HtmlPreviewDrawer = memo<HtmlPreviewDrawerProps>(({ content, open, onClose }) => {
  const { t } = useTranslation('components');
  const [mode, setMode] = useState<'preview' | 'code'>('preview');

  const htmlContent = content;

  const extractTitle = useCallback(() => {
    const m = htmlContent.match(/<title>([\S\s]*?)<\/title>/i);
    return m ? m[1].trim() : undefined;
  }, [htmlContent]);

  const sanitizeFileName = useCallback((name: string) => {
    return name
      .replaceAll(/["*/:<>?\\|]/g, '-')
      .replaceAll(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }, []);

  const onDownload = useCallback(() => {
    const title = extractTitle();
    const base = title ? sanitizeFileName(title) : `chat-html-preview-${Date.now()}`;
    exportFile(content, `${base}.html`);
  }, [content, extractTitle, sanitizeFileName]);

  const Title = (
    <Flexbox horizontal align={'center'} justify={'space-between'} style={{ width: '100%' }}>
      {t('HtmlPreview.title')}
      <Tabs
        activeKey={mode}
        items={[
          {
            key: 'preview',
            label: (
              <Flexbox horizontal align={'center'} gap={6}>
                <Eye size={16} />
                {t('HtmlPreview.mode.preview')}
              </Flexbox>
            ),
          },
          {
            key: 'code',
            label: (
              <Flexbox horizontal align={'center'} gap={6}>
                <Code2 size={16} />
                {t('HtmlPreview.mode.code')}
              </Flexbox>
            ),
          },
        ]}
        onChange={(key) => setMode(key as 'preview' | 'code')}
      />
      <Button icon={<Download size={16} />} type={'fill'} onClick={onDownload}>
        {t('HtmlPreview.actions.download')}
      </Button>
    </Flexbox>
  );

  return (
    <Drawer
      destroyOnHidden
      height={isDesktop ? `calc(100vh - ${TITLE_BAR_HEIGHT}px)` : '100vh'}
      open={open}
      placement="bottom"
      title={Title}
      styles={{
        body: { height: '100%', padding: 0 },
        header: { paddingBlock: 8, paddingInline: 12 },
      }}
      onClose={onClose}
    >
      {mode === 'preview' ? (
        <Block className={styles.container}>
          <HtmlPreview
            actionsRender={hideHtmlPreviewActions}
            copyable={false}
            downloadable={false}
            style={{ height: '100%' }}
            styles={{ iframe: { height: '100%' } }}
            title={t('HtmlPreview.iframeTitle')}
            variant={'borderless'}
          >
            {content}
          </HtmlPreview>
        </Block>
      ) : (
        <Block className={styles.container}>
          <Highlighter
            language={'html'}
            showLanguage={false}
            style={{ height: '100%', overflow: 'auto' }}
          >
            {htmlContent}
          </Highlighter>
        </Block>
      )}
    </Drawer>
  );
});

HtmlPreviewDrawer.displayName = 'HtmlPreviewDrawer';

export default HtmlPreviewDrawer;
