'use client';

import { CodeEditor, Form, type FormItemProps } from '@lobehub/ui';
import { Form as AForm, type FormInstance, Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const styles = createStaticStyles(({ css }) => ({
  wrapper: css`
    max-width: 720px;
    margin-inline: auto;
    padding-block: 0;
    padding-inline: 16px;
  `,
}));

export interface SkillEditFormValues {
  content: string;
  description: string;
}

interface SkillEditFormProps {
  form: FormInstance;
  initialValues: SkillEditFormValues;
  name?: string;
  onSubmit: (values: SkillEditFormValues) => void;
}

const SkillEditForm = memo<SkillEditFormProps>(({ name, form, initialValues, onSubmit }) => {
  const { t } = useTranslation('setting');
  const contentValue = AForm.useWatch('content', form);

  useEffect(() => {
    form.setFieldsValue(initialValues);
  }, [initialValues]);

  const items: FormItemProps[] = [
    {
      children: <Input disabled readOnly value={name} />,
      desc: t('agentSkillEdit.nameDesc'),
      label: t('settingAgent.name.title'),
    },
    {
      children: (
        <Input.TextArea
          autoSize={{ maxRows: 4, minRows: 2 }}
          placeholder={t('agentSkillModal.descriptionPlaceholder')}
        />
      ),
      desc: t('agentSkillEdit.descriptionDesc'),
      label: t('agentSkillModal.description'),
      name: 'description',
    },
    {
      children: (
        <CodeEditor
          language={'markdown'}
          onValueChange={(v) => form.setFieldValue('content', v)}
          placeholder={t('agentSkillEdit.instructionsPlaceholder')}
          value={contentValue || ''}
          variant={'outlined'}
        />
      ),
      desc: t('agentSkillEdit.instructionsDesc'),
      label: t('agentSkillEdit.instructions'),
      name: 'content',
    },
  ];

  return (
    <div className={styles.wrapper}>
      <Form
        form={form}
        gap={0}
        initialValues={initialValues}
        items={items}
        itemsType={'flat'}
        layout={'vertical'}
        onFinish={onSubmit}
        variant={'borderless'}
      />
    </div>
  );
});

SkillEditForm.displayName = 'SkillEditForm';

export default SkillEditForm;
