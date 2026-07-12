import { Button, Center, Flexbox, FluentEmoji } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { type ComponentType, type CSSProperties } from 'react';
import { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { MORE_FILE_PREVIEW_REQUEST_URL } from '@/const/url';
import { downloadFile } from '@/utils/client/downloadFile';

const styles = createStaticStyles(({ css, cssVar }) => ({
  page: css`
    width: 100%;
    margin: 12px;
    padding: 24px;
    border-radius: 4px;

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
}));

interface NotSupportProps {
  fileName?: string;
  style?: CSSProperties;
  url?: string | null;
}

const NotSupport: ComponentType<NotSupportProps> = ({ fileName, url, style }) => {
  const { t } = useTranslation('file');
  const [loading, setLoading] = useState(false);

  return (
    <Flexbox className={styles.page} id="not-support-renderer" style={style}>
      <Center height={'100%'}>
        <Flexbox align={'center'} gap={12}>
          <FluentEmoji emoji={'👀'} size={64} />
          <Flexbox style={{ textAlign: 'center' }}>
            <Trans
              i18nKey="preview.unsupportedFileAndContact"
              ns={'file'}
              components={[
                <span key="0" />,
                <a
                  aria-label={'todo'}
                  href={MORE_FILE_PREVIEW_REQUEST_URL}
                  key="1"
                  rel="noreferrer"
                  target="_blank"
                />,
              ]}
            />
          </Flexbox>
          {url && (
            <Button
              loading={loading}
              onClick={async () => {
                setLoading(true);
                await downloadFile(url, fileName || 'download');
                setLoading(false);
              }}
            >
              {t('preview.downloadFile')}
            </Button>
          )}
        </Flexbox>
      </Center>
    </Flexbox>
  );
};

export default NotSupport;
