import {
  type IEditor,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactListPlugin,
  ReactMathPlugin,
  ReactTablePlugin,
} from '@lobehub/editor';
import { Editor } from '@lobehub/editor/react';
import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Card } from 'antd';
import { Clock } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import TypoBar from '@/features/EditorModal/Typobar';

interface CronJobContentEditorProps {
  editor?: IEditor;
  enableRichRender: boolean;
  onContentChange: (e: IEditor) => void;
  onEditorReady: () => void;
}

const CronJobContentEditor = memo<CronJobContentEditorProps>(
  ({ editor, enableRichRender, onContentChange, onEditorReady }) => {
    const { t } = useTranslation('setting');

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
          {enableRichRender && <TypoBar editor={editor} />}
          <Flexbox padding={16} style={{ minHeight: 220 }}>
            <Editor
              content={''}
              editor={editor}
              lineEmptyPlaceholder={t('agentCronJobs.form.content.placeholder')}
              onInit={onEditorReady}
              onTextChange={onContentChange}
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
