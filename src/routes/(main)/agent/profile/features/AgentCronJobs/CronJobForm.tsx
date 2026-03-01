'use client';

import { Checkbox, Form, Input, InputNumber, Select, TimePicker } from 'antd';
import dayjs from 'dayjs';
import { memo, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgentCronJob } from '@/database/schemas/agentCronJob';

// Form data interface - excludes server-managed fields
interface CronJobFormData {
  content: string;
  cronPattern: string;
  enabled?: boolean;
  executionConditions?: any;
  maxExecutions?: number | null;
  name?: string | null;
}

const { TextArea } = Input;

interface CronJobFormProps {
  editingJob?: AgentCronJob;
  formRef?: any;
  onCancel?: () => void;
  onSubmit: (data: CronJobFormData) => void;
}

// Standard cron format: minute hour day month weekday
const CRON_PATTERNS = [
  { label: 'agentCronJobs.interval.30min', value: '*/30 * * * *' }, // Every 30 minutes
  { label: 'agentCronJobs.interval.1hour', value: '0 * * * *' }, // Every hour
  { label: 'agentCronJobs.interval.2hours', value: '0 */2 * * *' }, // Every 2 hours
  { label: 'agentCronJobs.interval.6hours', value: '0 */6 * * *' }, // Every 6 hours
  { label: 'agentCronJobs.interval.12hours', value: '0 */12 * * *' }, // Every 12 hours
  { label: 'agentCronJobs.interval.daily', value: '0 0 * * *' }, // Daily at midnight
  { label: 'agentCronJobs.interval.weekly', value: '0 0 * * 0' }, // Weekly on Sunday
];

const WEEKDAY_OPTIONS = [
  { label: 'Monday', value: 1 },
  { label: 'Tuesday', value: 2 },
  { label: 'Wednesday', value: 3 },
  { label: 'Thursday', value: 4 },
  { label: 'Friday', value: 5 },
  { label: 'Saturday', value: 6 },
  { label: 'Sunday', value: 0 },
];

const CronJobForm = memo<CronJobFormProps>(({ editingJob, formRef, onSubmit }) => {
  const { t } = useTranslation('setting');
  const [form] = Form.useForm();

  // Expose form instance via ref
  if (formRef) {
    formRef.current = form;
  }

  useEffect(() => {
    if (editingJob) {
      const conditions = editingJob.executionConditions;
      form.setFieldsValue({
        content: editingJob.content,
        cronPattern: editingJob.cronPattern,
        maxExecutions: editingJob.maxExecutions,
        maxExecutionsPerDay: conditions?.maxExecutionsPerDay,
        name: editingJob.name,
        timeRange: conditions?.timeRange
          ? [dayjs(conditions.timeRange.start, 'HH:mm'), dayjs(conditions.timeRange.end, 'HH:mm')]
          : undefined,
        weekdays: conditions?.weekdays || [],
      });
    } else {
      form.resetFields();
    }
  }, [editingJob, form]);

  const handleSubmit = async (values: any) => {
    const executionConditions: any = {};

    if (values.timeRange && values.timeRange.length === 2) {
      executionConditions.timeRange = {
        end: values.timeRange[1].format('HH:mm'),
        start: values.timeRange[0].format('HH:mm'),
      };
    }

    if (values.weekdays && values.weekdays.length > 0) {
      executionConditions.weekdays = values.weekdays;
    }

    if (values.maxExecutionsPerDay) {
      executionConditions.maxExecutionsPerDay = values.maxExecutionsPerDay;
    }

    const data: CronJobFormData = {
      content: values.content,
      cronPattern: values.cronPattern,
      enabled: false,
      executionConditions: Object.keys(executionConditions).length > 0 ? executionConditions : null,
      maxExecutions: values.maxExecutions || null,
      name: values.name,
    };

    onSubmit(data);
  };

  const validateTimeRange = (_: any, value: any) => {
    if (!value || value.length !== 2) {
      return Promise.resolve();
    }

    const [start, end] = value;
    if (start.isAfter(end)) {
      return Promise.reject(new Error(t('agentCronJobs.form.validation.invalidTimeRange')));
    }

    return Promise.resolve();
  };

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{
        cronPattern: '*/30 * * * *', // Default to every 30 minutes
        weekdays: [],
      }}
      onFinish={handleSubmit}
    >
      <Form.Item
        label={t('agentCronJobs.name')}
        name="name"
        rules={[{ message: t('agentCronJobs.form.validation.nameRequired'), required: true }]}
      >
        <Input placeholder={t('agentCronJobs.form.name.placeholder')} />
      </Form.Item>

      <Form.Item
        label={t('agentCronJobs.content')}
        name="content"
        rules={[{ message: t('agentCronJobs.form.validation.contentRequired'), required: true }]}
      >
        <TextArea
          showCount
          maxLength={1000}
          placeholder={t('agentCronJobs.form.content.placeholder')}
          rows={3}
        />
      </Form.Item>

      <Form.Item
        label={t('agentCronJobs.schedule')}
        name="cronPattern"
        rules={[{ required: true }]}
      >
        <Select>
          {CRON_PATTERNS.map((pattern) => (
            <Select.Option key={pattern.value} value={pattern.value}>
              {t(pattern.label as any)}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>

      <Form.Item label={t('agentCronJobs.maxExecutions')} name="maxExecutions">
        <InputNumber
          min={1}
          placeholder={t('agentCronJobs.form.maxExecutions.placeholder')}
          style={{ width: '100%' }}
        />
      </Form.Item>

      <Form.Item
        label={t('agentCronJobs.timeRange')}
        name="timeRange"
        rules={[{ validator: validateTimeRange }]}
      >
        <TimePicker.RangePicker
          format="HH:mm"
          style={{ width: '100%' }}
          placeholder={[
            t('agentCronJobs.form.timeRange.start'),
            t('agentCronJobs.form.timeRange.end'),
          ]}
        />
      </Form.Item>

      <Form.Item label={t('agentCronJobs.weekdays')} name="weekdays">
        <Checkbox.Group options={WEEKDAY_OPTIONS} />
      </Form.Item>

      <Form.Item label="Max Executions Per Day" name="maxExecutionsPerDay">
        <InputNumber
          min={1}
          placeholder="Leave empty for no daily limit"
          style={{ width: '100%' }}
        />
      </Form.Item>
    </Form>
  );
});

export default CronJobForm;
