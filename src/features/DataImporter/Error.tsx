import { Alert, Button, Flexbox, Highlighter, Icon } from '@lobehub/ui';
import { Result } from 'antd';
import { ShieldAlert } from 'lucide-react';
import React, { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Balancer from 'react-wrap-balancer';

import { GITHUB_ISSUES } from '@/const/url';
import { githubService } from '@/services/github';
import { type ErrorShape } from '@/types/importer';

interface ErrorProps {
  error?: ErrorShape;
  onClick: () => void;
}

const Error = memo<ErrorProps>(({ error, onClick }) => {
  const { t } = useTranslation('common');
  return (
    <Result
      icon={<Icon icon={ShieldAlert} />}
      status={'error'}
      style={{ paddingBlock: 24, width: 450 }}
      title={t('importModal.error.title')}
      extra={
        <Flexbox gap={12} style={{ textAlign: 'start' }}>
          <Alert
            style={{ flex: 1 }}
            title={error?.message}
            type={'error'}
            extra={
              <Highlighter actionIconSize={'small'} language={'json'}>
                {JSON.stringify(error, null, 2)}
              </Highlighter>
            }
          />
          <Button onClick={onClick}>{t('close')}</Button>
        </Flexbox>
      }
      subTitle={
        <Balancer>
          <Trans i18nKey="importModal.error.desc" ns={'common'}>
            Sorry, an error occurred during the data import process. Please try importing again, or
            <a
              aria-label={'issue'}
              href={GITHUB_ISSUES}
              rel="noreferrer"
              target="_blank"
              onClick={(e) => {
                e.preventDefault();
                githubService.submitImportError(error!);
              }}
            >
              submit a request
            </a>
            , and we will help you troubleshoot the issue as soon as possible.
          </Trans>
        </Balancer>
      }
    />
  );
});

export default Error;
