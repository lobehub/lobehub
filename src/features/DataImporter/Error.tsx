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
            非常抱歉，数据库升级过程发生异常。请重试升级，或
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
              提交问题
            </a>
            我们将会第一时间帮你排查问题。
          </Trans>
        </Balancer>
      }
    />
  );
});

export default Error;
