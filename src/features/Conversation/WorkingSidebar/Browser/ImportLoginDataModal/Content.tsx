'use client';

import type {
  BrowserLoginDataErrorCode,
  BrowserLoginDataSource,
  BrowserSidebarImportResult,
} from '@lobechat/electron-client-ipc';
import {
  Alert,
  Button,
  cssVar,
  Flexbox,
  Icon,
  RadioGroup,
  Segmented,
  Select,
  Skeleton,
  Text,
  useModalContext,
} from '@lobehub/ui';
import { Check, Minus } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { BROWSER_LOGIN_SOURCE_LABELS } from '../const';
import { type BrowserLoginDataScope, useImportLoginData } from './useImportLoginData';

interface ImportLoginDataContentProps {
  /** Runs after cookies were written, e.g. to reload the open page. */
  onImported?: (result: BrowserSidebarImportResult) => void;
}

const errorKey = (code?: BrowserLoginDataErrorCode) =>
  `workingPanel.browser.import.error.${code ?? 'unknown'}` as const;

export const ImportLoginDataContent = memo<ImportLoginDataContentProps>(({ onImported }) => {
  const { t } = useTranslation('chat');
  const { close } = useModalContext();
  const {
    canImport,
    domains,
    isImporting,
    isPreviewLoading,
    preview,
    result,
    retryPreview,
    runImport,
    scope,
    selectedDomains,
    setScope,
    setSelectedDomains,
    setSource,
    source,
  } = useImportLoginData(onImported);
  const browser = BROWSER_LOGIN_SOURCE_LABELS[source];

  const renderPreview = () => {
    if (isPreviewLoading || !preview)
      return (
        <Flexbox gap={8}>
          <Text type={'secondary'}>
            {t('workingPanel.browser.import.modal.loading', { browser })}
          </Text>
          <Skeleton height={32} width={'100%'} />
        </Flexbox>
      );

    if (!preview.success)
      return (
        <Alert
          showIcon
          title={t(errorKey(preview.errorCode), { browser })}
          type={'error'}
          action={
            <Button size={'small'} onClick={() => retryPreview()}>
              {t('workingPanel.browser.import.modal.retry')}
            </Button>
          }
        />
      );

    if (domains.length === 0)
      return (
        <Alert
          showIcon
          title={t('workingPanel.browser.import.modal.empty', { browser })}
          type={'info'}
        />
      );

    return (
      <Flexbox gap={8}>
        <RadioGroup
          value={scope}
          options={[
            {
              label: t('workingPanel.browser.import.modal.scopeAll', { count: domains.length }),
              value: 'all',
            },
            { label: t('workingPanel.browser.import.modal.scopeSelected'), value: 'selected' },
          ]}
          onChange={(value) => setScope(value as BrowserLoginDataScope)}
        />
        {scope === 'selected' && (
          <Select
            allowClear
            mode={'multiple'}
            placeholder={t('workingPanel.browser.import.modal.domainPlaceholder')}
            style={{ width: '100%' }}
            value={selectedDomains}
            options={domains.map(({ count, domain }) => ({
              label: t('workingPanel.browser.import.modal.domainOption', { count, domain }),
              value: domain,
            }))}
            onChange={(value: string[]) => setSelectedDomains(value)}
          />
        )}
        {preview.profile && (
          <Text fontSize={12} type={'secondary'}>
            {t('workingPanel.browser.import.modal.profile', { profile: preview.profile })}
          </Text>
        )}
      </Flexbox>
    );
  };

  const renderResult = () => {
    if (!result) return null;
    if (!result.success)
      return <Alert showIcon title={t(errorKey(result.errorCode), { browser })} type={'error'} />;

    const failed = result.failedDomains ?? [];
    return (
      <Flexbox gap={8}>
        <Alert
          showIcon
          type={'success'}
          title={t('workingPanel.browser.import.result.success', {
            count: result.importedCount,
            domains: result.importedDomainCount ?? 0,
          })}
        />
        {failed.length > 0 && (
          <Alert
            showIcon
            type={'warning'}
            title={t('workingPanel.browser.import.result.failedDomains', {
              count: failed.length,
              domains: failed.join(', '),
            })}
          />
        )}
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={16}>
      <Flexbox gap={8}>
        <Text strong>{t('workingPanel.browser.import.modal.source')}</Text>
        <Segmented<BrowserLoginDataSource>
          disabled={isImporting}
          value={source}
          options={(['edge', 'chrome'] as const).map((value) => ({
            label: BROWSER_LOGIN_SOURCE_LABELS[value],
            value,
          }))}
          onChange={setSource}
        />
      </Flexbox>
      <Flexbox gap={8}>
        <Text strong>{t('workingPanel.browser.import.modal.contents')}</Text>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon color={cssVar.colorSuccess} icon={Check} />
          <Text>{t('workingPanel.browser.import.modal.cookies')}</Text>
        </Flexbox>
        <Flexbox horizontal align={'flex-start'} gap={8}>
          <Icon icon={Minus} style={{ marginBlockStart: 4 }} />
          <Text type={'secondary'}>
            {t('workingPanel.browser.import.modal.excluded', { browser })}
          </Text>
        </Flexbox>
      </Flexbox>
      <Flexbox gap={8}>
        <Text strong>{t('workingPanel.browser.import.modal.scope')}</Text>
        {renderPreview()}
      </Flexbox>
      {renderResult()}
      <Text fontSize={12} type={'secondary'}>
        {t('workingPanel.browser.import.modal.privacy')}
      </Text>
      <Flexbox horizontal gap={8} justify={'flex-end'}>
        {result?.success ? (
          <Button type={'primary'} onClick={close}>
            {t('workingPanel.browser.import.modal.done')}
          </Button>
        ) : (
          <>
            <Button disabled={isImporting} onClick={close}>
              {t('workingPanel.browser.import.modal.cancel')}
            </Button>
            <Button
              disabled={!canImport}
              loading={isImporting}
              type={'primary'}
              onClick={runImport}
            >
              {t('workingPanel.browser.import.modal.submit')}
            </Button>
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
});

ImportLoginDataContent.displayName = 'BrowserImportLoginDataContent';
