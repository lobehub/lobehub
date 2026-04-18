'use client';

import {
  Accordion,
  AccordionItem,
  Block,
  Button,
  Flexbox,
  FluentEmoji,
  Highlighter,
} from '@lobehub/ui';
import type { Key } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MAX_WIDTH } from '@/const/layoutTokens';

export type ErrorType = Error & { digest?: string };

interface ErrorCaptureProps {
  error: ErrorType;
  /** Where "back home" navigates; defaults to `/`. */
  resetPath?: string;
}

const ErrorCapture = ({ error, resetPath = '/' }: ErrorCaptureProps) => {
  const { t } = useTranslation('error');
  const hasStack = !!error?.stack;
  const defaultExpandedKeys: Key[] = typeof __CI__ !== 'undefined' && __CI__ ? ['stack'] : [];
  const [expandedKeys, setExpandedKeys] = useState<Key[]>(defaultExpandedKeys);
  const isExpanded = expandedKeys.includes('stack');

  return (
    <Flexbox align={'center'} justify={'center'} style={{ minHeight: '100dvh', width: '100%' }}>
      <h1
        style={{
          filter: 'blur(8px)',
          fontSize: `min(${MAX_WIDTH / 6}px, 25vw)`,
          fontWeight: 900,
          margin: 0,
          opacity: 0.12,
          position: 'absolute',
          zIndex: 0,
        }}
      >
        ERROR
      </h1>
      <FluentEmoji emoji={'🤧'} size={64} />
      <h2 style={{ fontWeight: 'bold', marginTop: '1em', textAlign: 'center' }}>
        {t('error.title')}
      </h2>
      <p style={{ marginBottom: '2em' }}>{t('error.desc')}</p>
      <Flexbox horizontal gap={12} style={{ marginBottom: '2em' }}>
        <Button onClick={() => window.location.reload()}>{t('error.retry')}</Button>
        <Button type={'primary'} onClick={() => (window.location.href = resetPath)}>
          {t('error.backHome')}
        </Button>
      </Flexbox>
      {hasStack && (
        <Block
          variant={isExpanded ? 'outlined' : 'filled'}
          style={{
            marginBottom: '1em',
            maxWidth: '90vw',
            overflow: 'hidden',
            transition: 'background 0.2s, border-color 0.2s',
            width: 560,
          }}
        >
          <Accordion
            expandedKeys={expandedKeys}
            variant={'borderless'}
            onExpandedChange={setExpandedKeys}
          >
            <AccordionItem indicatorPlacement={'start'} itemKey={'stack'} title={t('error.stack')}>
              <Highlighter language={'plaintext'} padding={12} variant={'borderless'}>
                {error.stack!}
              </Highlighter>
            </AccordionItem>
          </Accordion>
        </Block>
      )}
    </Flexbox>
  );
};

export default ErrorCapture;
