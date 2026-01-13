import {
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor, useEditor } from '@lobehub/editor/react';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Card } from 'antd';
import { Clock } from 'lucide-react';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

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

    // Update currentValueRef when initialValue changes
    useEffect(() => {
      currentValueRef.current = initialValue;
    }, [initialValue]);

    // Initialize editor content when editor is ready
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

    // Handle content changes
    const handleContentChange = useCallback(
      (e: any) => {
        const nextContent = enableRichRender
          ? (e.getDocument('markdown') as unknown as string)
          : (e.getDocument('text') as unknown as string);

        const finalContent = nextContent || '';

        // Only call onChange if content actually changed
        if (finalContent !== currentValueRef.current) {
          currentValueRef.current = finalContent;
          onChange(finalContent);
        }
      },
      [enableRichRender, onChange],
    );

    return (
      <Flexbox gap={12}>
        <Flexbox align="center" gap={6} horizontal>
          <Icon icon={Clock} size={16} />
          <Text style={{ fontWeight: 600 }}>{t('agentCronJobs.content')}</Text>
        </Flexbox>
        <Card
          size="small"
          style={{ borderRadius: 12, overflow: 'hidden' }}
          styles={{ body: { padding: 0 } }}
        >
          <Flexbox padding={16} style={{ minHeight: 220 }}>
            <Editor
              content={''}
              editor={editor}
              lineEmptyPlaceholder={t('agentCronJobs.form.content.placeholder')}
              onTextChange={handleContentChange}
              placeholder={t('agentCronJobs.form.content.placeholder')}
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
              style={{ paddingBottom: 48 }}
              type={'text'}
              variant={'chat'}
            />
          </Flexbox>
        </Card>
      </Flexbox>
    );
  },
);

export default CronJobContentEditor;
