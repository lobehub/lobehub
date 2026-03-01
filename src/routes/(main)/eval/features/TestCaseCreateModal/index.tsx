'use client';

import { Accordion, AccordionItem, Flexbox, Modal, Text } from '@lobehub/ui';
import { App, Form, Input, Select } from 'antd';
import { memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';

interface TestCaseCreateModalProps {
  datasetId: string;
  onClose: () => void;
  onSuccess?: (datasetId: string) => void;
  open: boolean;
}

const TestCaseCreateModal = memo<TestCaseCreateModalProps>(
  ({ open, onClose, datasetId, onSuccess }) => {
    const { t } = useTranslation('eval');
    const { message } = App.useApp();
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);
    const evalModeValue = Form.useWatch('evalMode', form);

    const handleClose = useCallback(() => {
      form.resetFields();
      onClose();
    }, [form, onClose]);

    const handleSubmit = useCallback(async () => {
      const values = await form.validateFields();
      setLoading(true);
      try {
        const tags = values.tags
          ? values.tags
              .split(',')
              .map((t: string) => t.trim())
              .filter(Boolean)
          : undefined;

        await agentEvalService.createTestCase({
          content: {
            expected: values.expected,
            input: values.input,
          },
          datasetId,
          evalConfig: values.evalConfig?.judgePrompt ? values.evalConfig : undefined,
          evalMode: values.evalMode || undefined,
          metadata: {
            ...(values.difficulty ? { difficulty: values.difficulty } : {}),
            ...(tags ? { tags } : {}),
          },
        });

        setTimeout(() => {
          message.success(t('testCase.create.success'));
        }, 0);
        handleClose();
        onSuccess?.(datasetId);
      } catch {
        setTimeout(() => {
          message.error(t('testCase.create.error'));
        }, 0);
      } finally {
        setLoading(false);
      }
    }, [datasetId, form, handleClose, message, onSuccess, t]);

    return (
      <Modal
        destroyOnHidden
        okButtonProps={{ loading }}
        okText={t('common.create')}
        open={open}
        title={t('testCase.create.title')}
        width={520}
        onCancel={handleClose}
        onOk={handleSubmit}
      >
        <Form form={form} layout="vertical" style={{ paddingTop: 16 }}>
          <Form.Item
            label={t('testCase.create.input.label')}
            name="input"
            rules={[{ required: true }]}
          >
            <Input.TextArea
              autoSize={{ maxRows: 6, minRows: 3 }}
              placeholder={t('testCase.create.input.placeholder')}
            />
          </Form.Item>
          <Form.Item
            label={t('testCase.create.expected.label')}
            name="expected"
            rules={[{ message: t('testCase.create.expected.required'), required: true }]}
          >
            <Input.TextArea
              autoSize={{ maxRows: 6, minRows: 2 }}
              placeholder={t('testCase.create.expected.placeholder')}
            />
          </Form.Item>
          <Form.Item label={t('evalMode.label')} name="evalMode">
            <Select
              allowClear
              placeholder={t('evalMode.placeholder')}
              optionRender={(option) => (
                <Flexbox gap={2} style={{ padding: '4px 0' }}>
                  <div>{option.label}</div>
                  <Text style={{ fontSize: 12 }} type="secondary">
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
          </Form.Item>
          {evalModeValue === 'llm-rubric' && (
            <Form.Item label={t('evalMode.prompt.label')} name={['evalConfig', 'judgePrompt']}>
              <Input.TextArea
                autoSize={{ maxRows: 8, minRows: 3 }}
                placeholder={t('evalMode.prompt.placeholder')}
              />
            </Form.Item>
          )}
          <Accordion>
            <AccordionItem
              itemKey="advanced"
              paddingBlock={6}
              paddingInline={4}
              title={t('testCase.create.advanced')}
            >
              <Flexbox gap={16} style={{ paddingTop: 8 }}>
                <Form.Item
                  label={t('testCase.create.difficulty.label')}
                  name="difficulty"
                  style={{ marginBottom: 0 }}
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
                </Form.Item>
                <Form.Item
                  label={t('testCase.create.tags.label')}
                  name="tags"
                  style={{ marginBottom: 0 }}
                >
                  <Input placeholder={t('testCase.create.tags.placeholder')} />
                </Form.Item>
              </Flexbox>
            </AccordionItem>
          </Accordion>
        </Form>
      </Modal>
    );
  },
);

export default TestCaseCreateModal;
