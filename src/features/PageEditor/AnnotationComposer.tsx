'use client';

import type { AnnotationComposerContext } from '@lobehub/editor';
import { TextArea } from '@lobehub/ui';
import { Button, Text } from '@lobehub/ui/base-ui';
import { createStaticStyles } from 'antd-style';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    justify-content: flex-end;

    min-width: 0;
    max-width: 100%;

    & > * {
      min-width: 0;
      max-width: 100%;
    }

    & > button {
      overflow: hidden;
      flex: 0 1 auto;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
  composer: css`
    display: flex;
    flex-direction: column;
    gap: 10px;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;
    padding: 12px;
    border: 1px solid ${cssVar.colorPrimaryBorder};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorBgContainer};
    box-shadow: ${cssVar.boxShadowTertiary};
  `,
  header: css`
    display: flex;
    align-items: center;

    min-width: 0;
    max-width: 100%;
    min-height: 20px;
  `,
  quote: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;

    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    padding-block: 8px;
    padding-inline: 10px;
    border-inline-start: 2px solid ${cssVar.colorPrimary};
    border-radius: 0 ${cssVar.borderRadius} ${cssVar.borderRadius} 0;

    font-size: 12px;
    line-height: 18px;
    color: ${cssVar.colorTextSecondary};
    text-overflow: ellipsis;
    word-break: break-word;
    overflow-wrap: anywhere;

    background: ${cssVar.colorFillQuaternary};
  `,
  title: css`
    overflow: hidden;

    min-width: 0;
    max-width: 100%;

    font-size: 13px;
    font-weight: 600;
    line-height: 20px;
    color: ${cssVar.colorText};
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  input: css`
    display: block;

    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    max-width: 100%;

    & textarea {
      overflow-x: hidden;

      box-sizing: border-box;
      width: 100%;
      min-width: 0;
      max-width: 100%;

      word-break: break-word;
      overflow-wrap: anywhere;
    }

    &:focus-within {
      border-color: ${cssVar.colorPrimary};
      box-shadow: 0 0 0 2px ${cssVar.colorPrimaryBg};
    }
  `,
}));

const AnnotationComposer = ({ close, nodeKeys, quotedText, submit }: AnnotationComposerContext) => {
  const [text, setText] = useState('');
  const { t } = useTranslation('editor');
  const targetKey = nodeKeys?.join(',');

  useEffect(() => {
    setText('');
  }, [quotedText, targetKey]);

  return (
    <div className={styles.composer}>
      <div className={styles.header}>
        <Text className={styles.title}>{t('annotation.add')}</Text>
      </div>
      <Text
        className={styles.quote}
        ellipsis={{ rows: 3, tooltip: quotedText || t('annotation.noQuote') }}
        type="secondary"
      >
        {quotedText || t('annotation.noQuote')}
      </Text>
      <TextArea
        autoFocus
        className={styles.input}
        placeholder={t('annotation.placeholder')}
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className={styles.actions}>
        <Button size="small" type="text" onClick={close}>
          {t('cancel')}
        </Button>
        <Button
          disabled={!text.trim()}
          size="small"
          type="primary"
          onClick={() => submit({ kind: 'comment', payload: { text: text.trim() } })}
        >
          {t('annotation.submit')}
        </Button>
      </div>
    </div>
  );
};

export default AnnotationComposer;
