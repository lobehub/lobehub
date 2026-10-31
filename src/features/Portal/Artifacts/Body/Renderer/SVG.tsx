import { BRANDING_NAME } from '@lobechat/business-const';
import { copyImageToClipboard } from '@lobechat/utils/client';
import { Button, DropdownMenu, Flexbox, toast, Tooltip } from '@lobehub/ui';
import * as stylex from '@stylexjs/stylex';
import { CopyIcon, DownloadIcon } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

import { getSvgFrameProps, rasterizeSvg } from './svgDocument';

const styles = stylex.create({
  actions: { position: 'absolute', insetBlockEnd: '8px', insetInlineEnd: '8px' },
  svgFrame: {
    width: '100%',
    height: '100%',
    borderStyle: 'none',
    // Matches the srcdoc's light scheme so prefers-color-scheme inside the SVG resolves to light,
    // consistent with the white preview canvas, even when the app runs in dark mode.
    colorScheme: 'light',
  },
});

interface SVGRendererProps {
  content: string;
}

const SVGRenderer = ({ content }: SVGRendererProps) => {
  const { t } = useTranslation('portal');

  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameProps = useMemo(() => getSvgFrameProps(content), [content]);

  // Rasterize at the preview's on-screen size so the PNG matches what the user sees
  const generatePng = () => {
    const frame = frameRef.current;

    return rasterizeSvg(content, {
      height: frame?.clientHeight || 600,
      width: frame?.clientWidth || 800,
    });
  };

  const downloadImage = async (type: string) => {
    let dataUrl = '';
    if (type === 'png') dataUrl = await generatePng();
    else if (type === 'svg') {
      const blob = new Blob([content], { type: 'image/svg+xml' });

      dataUrl = URL.createObjectURL(blob);
    }

    const title = chatPortalSelectors.artifactTitle(useChatStore.getState());

    const link = document.createElement('a');
    link.download = `${BRANDING_NAME}_${title}.${type}`;
    link.href = dataUrl;
    link.click();
    link.remove();
  };

  return (
    <Flexbox
      align={'center'}
      className="svg-renderer"
      height={'100%'}
      style={{ position: 'relative' }}
    >
      <iframe
        {...stylex.props(styles.svgFrame)}
        ref={frameRef}
        title={'svg-renderer'}
        {...frameProps}
      />
      <Flexbox horizontal className={stylex.props(styles.actions).className} gap={4}>
        <DropdownMenu
          items={[
            {
              key: 'png',
              label: t('artifacts.svg.download.png'),
              onClick: () => downloadImage('png'),
            },
            {
              key: 'svg',
              label: t('artifacts.svg.download.svg'),
              onClick: () => downloadImage('svg'),
            },
          ]}
        >
          <Button icon={DownloadIcon} />
        </DropdownMenu>
        <Tooltip title={t('artifacts.svg.copyAsImage')}>
          <Button
            icon={CopyIcon}
            onClick={async () => {
              try {
                await copyImageToClipboard(await generatePng());
                toast.success(t('artifacts.svg.copySuccess'));
              } catch (e) {
                toast.error(t('artifacts.svg.copyFail', { error: e }));
              }
            }}
          />
        </Tooltip>
      </Flexbox>
    </Flexbox>
  );
};

export default SVGRenderer;
