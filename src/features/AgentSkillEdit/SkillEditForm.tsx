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
import { Input, TextArea } from '@lobehub/ui';
import { Form, type FormFieldProps, type FormInstance } from '@lobehub/ui/form';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { memo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

const styles = stylex.create({
  editorWrapper: {
    minHeight: '200px',
    paddingBlock: '8px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorder,
    borderRadius: '8px',
  },
  wrapper: { maxWidth: '798px', marginInline: 'auto', paddingBlock: '0', paddingInline: '24px' },
});

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
          className={stylex.props(styles.editorWrapper).className}
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
    <div {...stylex.props(styles.wrapper)}>
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
