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
import { type RefObject, memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface CronJobContentEditorProps {
  enableRichRender: boolean;
  initialValue: string;
  onChange: (value: string) => void;
}

interface CronJobContentEditorInnerProps extends CronJobContentEditorProps {
  contentRef: RefObject<string>;
}

const CronJobContentEditorInner = memo<CronJobContentEditorInnerProps>(
  ({ enableRichRender, initialValue, onChange, contentRef }) => {
    const { t } = useTranslation('setting');
    const editor = useEditor();
    const currentValueRef = useRef(initialValue);

    // Update currentValueRef when initialValue changes
    useEffect(() => {
      currentValueRef.current = initialValue;
    }, [initialValue]);

    // Handle content changes
    const handleContentChange = useCallback(
      (e: any) => {
        const nextContent = enableRichRender
          ? (e.getDocument('markdown') as unknown as string)
          : (e.getDocument('text') as unknown as string);

        const finalContent = nextContent || '';

        // Save to parent ref for restoration
        if (contentRef) {
          (contentRef as { current: string }).current = finalContent;
        }

        // Only call onChange if content actually changed
        if (finalContent !== currentValueRef.current) {
          currentValueRef.current = finalContent;
          onChange(finalContent);
        }
      },
      [enableRichRender, onChange, contentRef],
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
              onInit={(editor) => {
                // Restore content from parent ref when editor re-initializes
                if (contentRef?.current) {
                  editor.setDocument(enableRichRender ? 'markdown' : 'text', contentRef.current);
                } else if (initialValue) {
                  editor.setDocument(enableRichRender ? 'markdown' : 'text', initialValue);
                }
              }}
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

const CronJobContentEditor = (props: CronJobContentEditorProps) => {
  // Ref to persist content across re-mounts when enableRichRender changes
  const contentRef = useRef<string>(props.initialValue);

  return (
    <CronJobContentEditorInner
      contentRef={contentRef}
      key={`editor-${props.enableRichRender}`}
      {...props}
    />
  );
};

export default CronJobContentEditor;
