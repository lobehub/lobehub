'use client';

import {
  Accordion,
  createStaticStyles,
  cssVar,
  Flexbox,
  Input,
  Select,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { Form, useForm, useWatch } from '@lobehub/ui/form';
import { type FC } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

const styles = createStaticStyles(({ css }) => ({
  sectionLabel: css`
    margin-block-end: 12px;
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
}));

export interface TestCaseEditContentProps {
  formId: string;
  onLoadingChange?: (loading: boolean) => void;
  onSuccess?: (datasetId: string) => void;
  testCase: any;
}

const TestCaseEditContent: FC<TestCaseEditContentProps> = ({
  formId,
  onLoadingChange,
  onSuccess,
  testCase,
}) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();

  const handleFinish = async (values: any) => {
    onLoadingChange?.(true);
    try {
      const tags = values.tags
        ? values.tags
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean)
        : undefined;

      await agentEvalService.updateTestCase({
        content: {
          category: values.category || undefined,
          expected: values.expected,
          input: values.input,
        },
        evalConfig:
          values.evalMode === 'llm-rubric' && values.evalConfig?.judgePrompt
            ? values.evalConfig
            : null,
        evalMode: values.evalMode || null,
        id: testCase.id,
        metadata: {
          ...(values.difficulty ? { difficulty: values.difficulty } : {}),
          ...(tags ? { tags } : {}),
        },
      });

      await onSuccess?.(testCase.datasetId);
      toast.success(t('testCase.edit.success'));
      close();
    } catch {
      toast.error(t('testCase.edit.error'));
    } finally {
      onLoadingChange?.(false);
    }
  };

  const form = useForm({
    initialValues: {
      category: testCase.content?.category,
      difficulty: testCase.metadata?.difficulty,
      evalConfig: { judgePrompt: testCase.evalConfig?.judgePrompt },
      evalMode: testCase.evalMode || undefined,
      expected: testCase.content?.expected,
      input: testCase.content?.input,
      tags: testCase.metadata?.tags?.join(', '),
    },
    onSubmit: handleFinish,
  });
  const evalModeValue = useWatch(form, 'evalMode');

  return (
    <Form form={form} id={formId} layout="vertical">
      <div className={styles.sectionLabel}>{t('caseDetail.section.testCase')}</div>
      <Form.Field required label={t('testCase.create.input.label')} name="input">
        <TextArea
          autoSize={{ maxRows: 6, minRows: 3 }}
          placeholder={t('testCase.create.input.placeholder')}
        />
      </Form.Field>
      <Form.Field
        label={t('testCase.create.expected.label')}
        name="expected"
        required={t('testCase.create.expected.required')}
      >
        <TextArea
          autoSize={{ maxRows: 6, minRows: 2 }}
          placeholder={t('testCase.create.expected.placeholder')}
        />
      </Form.Field>
      <div className={styles.sectionLabel} style={{ marginBlockStart: 4 }}>
        {t('caseDetail.section.scoring')}
      </div>
      <Form.Field label={t('evalMode.label')} name="evalMode">
        <Select
          allowClear
          placeholder={t('evalMode.placeholder')}
          optionRender={(option) => (
            <Flexbox gap={4} style={{ paddingBlock: 4 }}>
              <div>{option.label}</div>
              <Text fontSize={12} type="secondary">
                {t(`evalMode.${option.value}.desc` as any)}
              </Text>
            </Flexbox>
          )}
          options={[
            { label: t('evalMode.equals'), value: 'equals' },
            { label: t('evalMode.contains'), value: 'contains' },
            { label: t('evalMode.llm-rubric'), value: 'llm-rubric' },
          ]}
        />
      </Form.Field>
      {evalModeValue === 'llm-rubric' && (
        <Form.Field label={t('evalMode.prompt.label')} name="evalConfig.judgePrompt">
          <TextArea
            autoSize={{ maxRows: 8, minRows: 3 }}
            placeholder={t('evalMode.prompt.placeholder')}
          />
        </Form.Field>
      )}
      <Accordion
        keepMounted
        indicatorPlacement="inline"
        styles={{ header: { paddingBlock: 8, paddingInline: 4 } }}
        items={[
          {
            children: (
              <Flexbox gap={16} style={{ paddingBlockStart: 8 }}>
                <Form.Field
                  label={t('table.columns.category')}
                  name="category"
                  style={{ paddingBlock: 0 }}
                >
                  <Input placeholder={t('dataset.import.categoryDesc')} />
                </Form.Field>
                <Form.Field
                  label={t('testCase.create.difficulty.label')}
                  name="difficulty"
                  style={{ paddingBlock: 0 }}
                >
                  <Select
                    allowClear
                    placeholder={t('testCase.create.difficulty.label')}
                    options={[
                      { label: t('difficulty.easy'), value: 'easy' },
                      { label: t('difficulty.medium'), value: 'medium' },
                      { label: t('difficulty.hard'), value: 'hard' },
                    ]}
                  />
                </Form.Field>
                <Form.Field
                  label={t('testCase.create.tags.label')}
                  name="tags"
                  style={{ paddingBlock: 0 }}
                >
                  <Input placeholder={t('testCase.create.tags.placeholder')} />
                </Form.Field>
              </Flexbox>
            ),
            key: 'advanced',
            title: t('testCase.create.advanced'),
          },
        ]}
      />
    </Form>
  );
};

export default TestCaseEditContent;
