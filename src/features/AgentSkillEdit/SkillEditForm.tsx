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
import { Input, TextArea } from '@lobehub/ui/base-ui';
import { Form, type FormFieldProps, type FormInstance } from '@lobehub/ui/base-ui/form';
import { createStaticStyles, cssVar } from 'antd-style';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  editorWrapper: css`
    min-height: 200px;
    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid ${cssVar.colorBorder};
    border-radius: 8px;
  `,
  wrapper: css`
    max-width: 798px;
    margin-inline: auto;
    padding-block: 0;
    padding-inline: 24px;
  `,
}));

const PLUGINS = [
  ReactListPlugin,
  ReactCodePlugin,
  ReactCodemirrorPlugin,
  ReactHRPlugin,
  ReactLinkPlugin,
  ReactTablePlugin,
  ReactMathPlugin,
];

export interface SkillEditFormValues {
  content: string;
  description: string;
}

interface SkillEditFormProps {
  disabled?: boolean;
  form: FormInstance<SkillEditFormValues>;
  initialValues: SkillEditFormValues;
  name?: string;
}

const SkillEditForm = memo<SkillEditFormProps>(({ name, disabled, form, initialValues }) => {
  const { t } = useTranslation('setting');
  const editor = useEditor();
  const currentValueRef = useRef(initialValues.content);

  useEffect(() => {
    form.setValues(initialValues);
  }, [form, initialValues]);

  useEffect(() => {
    currentValueRef.current = initialValues.content;
  }, [initialValues.content]);

  useEffect(() => {
    if (!editor) return;
    try {
      setTimeout(() => {
        if (initialValues.content) {
          editor.setDocument('markdown', initialValues.content);
        }
      }, 100);
    } catch {
      setTimeout(() => {
        editor.setDocument('markdown', initialValues.content);
      }, 100);
    }
  }, [editor, initialValues.content]);

  const handleContentChange = useCallback(
    (e: any) => {
      if (disabled) return;
      const nextContent = (e.getDocument('markdown') as unknown as string) || '';
      if (nextContent !== currentValueRef.current) {
        currentValueRef.current = nextContent;
        form.setValue('content', nextContent);
      }
    },
    [disabled, form],
  );

  const items: FormFieldProps<SkillEditFormValues>[] = [
    {
      children: <Input disabled readOnly value={name} />,
      desc: t('agentSkillEdit.nameDesc'),
      label: t('settingAgent.name.title'),
    },
    {
      children: (
        <TextArea
          autoSize={{ maxRows: 4, minRows: 2 }}
          disabled={disabled}
          placeholder={t('agentSkillModal.descriptionPlaceholder')}
        />
      ),
      desc: t('agentSkillEdit.descriptionDesc'),
      label: t('agentSkillModal.description'),
      name: 'description',
    },
    {
      children: (
        <div
          className={styles.editorWrapper}
          style={{ pointerEvents: disabled ? 'none' : undefined }}
        >
          <Editor
            content={''}
            editor={editor}
            lineEmptyPlaceholder={t('agentSkillEdit.instructionsPlaceholder')}
            placeholder={t('agentSkillEdit.instructionsPlaceholder')}
            plugins={PLUGINS}
            style={{ paddingBottom: 48 }}
            type={'text'}
            variant={'chat'}
            onTextChange={handleContentChange}
          />
        </div>
      ),
      desc: t('agentSkillEdit.instructionsDesc'),
      label: t('agentSkillEdit.instructions'),
    },
  ];

  return (
    <div className={styles.wrapper}>
      <Form
        form={form}
        gap={0}
        items={items}
        itemsType={'flat'}
        layout={'vertical'}
        variant={'borderless'}
      />
    </div>
  );
});

SkillEditForm.displayName = 'SkillEditForm';

export default SkillEditForm;
