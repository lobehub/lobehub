'use client';

// Highlighter is intentionally avoided: it pulls every shiki grammar (~10 MB) into the auth bundle
import { Block, Flexbox, FluentEmoji, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Result } from 'antd';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

const FailedPage = () => {
  const { t } = useTranslation('oauth');
  const [searchParams] = useSearchParams();

  const reason = searchParams.get('reason');
  const errorMessage = searchParams.get('errorMessage');

  return (
    <Result
      icon={<FluentEmoji emoji={'🥵'} size={96} type={'anim'} />}
      status="error"
      extra={
        <a href="/">
          <Button block size={'large'} style={{ minWidth: 240 }}>
            {t('error.backToHome')}
          </Button>
        </a>
      }
      subTitle={
        <Flexbox gap={8}>
          <Text fontSize={16} type="secondary">
            {t('error.desc', {
              reason: t(`error.reason.${reason}` as any, { defaultValue: reason ?? '' }),
            })}
          </Text>
          {!!errorMessage && (
            <Block padding={12} style={{ maxHeight: 240, overflowY: 'auto' }} variant={'filled'}>
              <pre
                style={{
                  fontFamily: 'monospace',
                  margin: 0,
                  overflowX: 'auto',
                  textAlign: 'start',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {errorMessage}
              </pre>
            </Block>
          )}
        </Flexbox>
      }
      title={
        <Text fontSize={32} weight={'bold'}>
          {t('error.title')}
        </Text>
      }
    />
  );
};

export default FailedPage;
