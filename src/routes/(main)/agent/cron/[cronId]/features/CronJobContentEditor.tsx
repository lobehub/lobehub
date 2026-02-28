'use client';

import {
  ReactCodemirrorPlugin,
  ReactCodePlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { FormGroup } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  editorWrapper: css`
    min-height: 200px;
    padding-block: 8px;
    padding-inline: 0;
  `,
}));

interface CronJobContentEditorProps {
  enableRichRender: boolean;
  initialValue: string;
  onChange: (value: string) => void;
}

const CronJobContentEditor = memo<CronJobContentEditorProps>(
  ({ enableRichRender, initialValue, onChange }) => {
    const { t } = useTranslation('setting');
    const editor = useEditor();
    const currentValueRef = useRef(initialValue);

    useEffect(() => {
      currentValueRef.current = initialValue;
    }, [initialValue]);

    useEffect(() => {
      if (!editor) return;
      try {
        setTimeout(() => {
          if (initialValue) {
            editor.setDocument(enableRichRender ? 'markdown' : 'text', initialValue);
          }
        }, 100);
      } catch (error) {
        console.error('[CronJobContentEditor] Failed to initialize editor content:', error);
        setTimeout(() => {
          editor.setDocument(enableRichRender ? 'markdown' : 'text', initialValue);
        }, 100);
      }
    }, [editor, enableRichRender, initialValue]);

    const handleContentChange = useCallback(
      (e: any) => {
        const nextContent = enableRichRender
          ? (e.getDocument('markdown') as unknown as string)
          : (e.getDocument('text') as unknown as string);

        const finalContent = nextContent || '';

        if (finalContent !== currentValueRef.current) {
          currentValueRef.current = finalContent;
          onChange(finalContent);
        }
      },
      [enableRichRender, onChange],
    );

    return (
      <FormGroup title={t('agentCronJobs.content')} variant="filled">
        <div className={styles.editorWrapper}>
          <Editor
            content={''}
            editor={editor}
            lineEmptyPlaceholder={t('agentCronJobs.form.content.placeholder')}
            placeholder={t('agentCronJobs.form.content.placeholder')}
            style={{ paddingBottom: 48 }}
            type={'text'}
            variant={'chat'}
            plugins={
              enableRichRender
                ? [
                    ReactListPlugin,
                    ReactCodePlugin,
                    ReactCodemirrorPlugin,
                    ReactHRPlugin,
                    ReactLinkPlugin,
                    ReactTablePlugin,
                    ReactMathPlugin,
                  ]
                : undefined
            }
            onTextChange={handleContentChange}
          />
        </div>
      </FormGroup>
    );
  },
);

export default CronJobContentEditor;
