import { BRANDING_NAME } from '@lobechat/business-const';
import { copyImageToClipboard, sanitizeSVGContent } from '@lobechat/utils/client';
import { Button, Center, Dropdown, Flexbox, Tooltip } from '@lobehub/ui';
import { snapdom } from '@zumer/snapdom';
import { App, Space } from 'antd';
import { css, cx } from 'antd-style';
import { CopyIcon, DownloadIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore } from '@/store/chat';
import { chatPortalSelectors } from '@/store/chat/selectors';

const svgContainer = css`
  width: 100%;
  height: 100%;

  > svg {
    width: 100%;
    height: 100%;
  }
`;

const actions = css`
  position: absolute;
  inset-block-end: 8px;
  inset-inline-end: 8px;
`;

const DOM_ID = 'artfact-svg';
interface SVGRendererProps {
  content: string;
}

const SVGRenderer = ({ content }: SVGRendererProps) => {
  const { t } = useTranslation('portal');
  const { message } = App.useApp();

  // Sanitize SVG content to prevent XSS attacks
  const sanitizedContent = useMemo(() => sanitizeSVGContent(content), [content]);

  const generatePng = async () => {
    const blob = await snapdom.toBlob(document.querySelector(`#${DOM_ID}`) as HTMLDivElement, {
      scale: 2,
      type: 'png',
    });

    if (!blob) {
      throw new Error('Failed to generate PNG blob');
    }

    // Convert blob to data URL
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('FileReader result is not a string'));
        }
      });
      reader.addEventListener('error', () =>
        reject(reader.error || new Error('Failed to read blob as data URL')),
      );
      reader.readAsDataURL(blob);
    });
  };

  const downloadImage = async (type: string) => {
    let dataUrl = '';
    if (type === 'png') dataUrl = await generatePng();
    else if (type === 'svg') {
      const blob = new Blob([sanitizedContent], { type: 'image/svg+xml' });

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
      <Center
        className={cx(svgContainer)}
        dangerouslySetInnerHTML={{ __html: sanitizedContent }}
        id={DOM_ID}
      />
      <Flexbox className={cx(actions)}>
        <Space.Compact>
          <Dropdown
            menu={{
              items: [
                { key: 'png', label: t('artifacts.svg.download.png') },
                { key: 'svg', label: t('artifacts.svg.download.svg') },
              ],
              onClick: ({ key }) => {
                downloadImage(key);
              },
            }}
          >
            <Button icon={DownloadIcon} />
          </Dropdown>
          <Tooltip title={t('artifacts.svg.copyAsImage')}>
            <Button
              icon={CopyIcon}
              onClick={async () => {
                const dataUrl = await generatePng();
                try {
                  await copyImageToClipboard(dataUrl);
                  message.success(t('artifacts.svg.copySuccess'));
                } catch (e) {
                  message.error(t('artifacts.svg.copyFail', { error: e }));
                }
              }}
            />
          </Tooltip>
        </Space.Compact>
      </Flexbox>
    </Flexbox>
  );
};

export default SVGRenderer;
