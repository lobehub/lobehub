'use client';

import type { GenericWebhookTopicMode, InboundWebhookItem } from '@lobechat/types';
import {
  Button,
  createModal,
  Flexbox,
  Icon,
  Input,
  type ModalInstance,
  Segmented,
  Switch,
  Text,
  TextArea,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t as translate } from 'i18next';
import { CheckCircle2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CommandLine from '@/components/CommandLine';
import CopyableLabel from '@/components/CopyableLabel';
import { inboundWebhookService } from '@/services/inboundWebhook';

import { curlExamples } from './endpoint';

const styles = stylex.create({
  hint: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
  successIcon: { color: cssVar.colorSuccess },
  urlBlock: {
    paddingBlock: '8px',
    paddingInline: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '12px',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  warning: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorWarning },
});

const Field = ({
  children,
  hint,
  label,
}: {
  children: ReactNode;
  hint?: ReactNode;
  label: string;
}) => (
  <Flexbox gap={6}>
    <Text weight={500}>{label}</Text>
    {children}
    {hint && <span {...stylex.props(styles.hint)}>{hint}</span>}
  </Flexbox>
);

interface WebhookFormProps {
  agentId: string;
  /** Edit this webhook; absent: create one. */
  item?: InboundWebhookItem;
  onSaved: (item: InboundWebhookItem) => void;
}

const WebhookForm = ({ agentId, item, onSaved }: WebhookFormProps) => {
  const { t } = useTranslation('agent');
  const { close } = useModalContext();
  const source = item?.source.kind === 'generic' ? item.source : undefined;
  const [name, setName] = useState(item?.name ?? '');
  const [instructions, setInstructions] = useState(item?.instructions ?? '');
  const [topicMode, setTopicMode] = useState<GenericWebhookTopicMode>(source?.topicMode ?? 'new');
  const [autoApprove, setAutoApprove] = useState(source?.autoApprove ?? false);
  const [saving, setSaving] = useState(false);
  // Set once a new webhook exists; the modal then shows its URL to copy.
  const [created, setCreated] = useState<InboundWebhookItem>();

  const submit = async () => {
    setSaving(true);
    try {
      const settings = { autoApprove, instructions, name, topicMode };
      if (item) {
        onSaved(await inboundWebhookService.update(item.id, settings));
        toast.success(t('webhook.form.saved'));
        close();
      } else {
        const next = await inboundWebhookService.create(agentId, settings);
        onSaved(next);
        setCreated(next);
      }
    } catch {
      toast.error(t(item ? 'webhook.form.saveFailed' : 'webhook.form.createFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (created?.endpoint) {
    return (
      <Flexbox gap={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Icon
            className={stylex.props(styles.successIcon).className}
            icon={CheckCircle2}
            size={18}
          />
          <Text weight={500}>{t('webhook.created.title')}</Text>
        </Flexbox>
        <Field hint={t('webhook.created.urlHint')} label={t('webhook.endpoint.label')}>
          <CopyableLabel
            wrap
            className={stylex.props(styles.urlBlock).className}
            value={created.endpoint}
          />
        </Field>
        <Field label={t('webhook.created.tryIt')}>
          <CommandLine command={curlExamples(created.endpoint).text} />
        </Field>
        <Button block type={'primary'} onClick={() => close()}>
          {t('webhook.created.done')}
        </Button>
      </Flexbox>
    );
  }

  return (
    <Flexbox gap={20}>
      <Field label={t('webhook.form.name.label')}>
        <Input
          maxLength={100}
          placeholder={t('webhook.form.name.placeholder')}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Field>
      <Field
        hint={t('webhook.form.instructions.hint')}
        label={t('webhook.form.instructions.label')}
      >
        <TextArea
          autoSize={{ maxRows: 8, minRows: 3 }}
          maxLength={4000}
          placeholder={t('webhook.form.instructions.placeholder')}
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
      </Field>
      <Field
        label={t('webhook.form.topicMode.label')}
        hint={t(
          topicMode === 'reuse'
            ? 'webhook.form.topicMode.reuseHint'
            : 'webhook.form.topicMode.newHint',
        )}
      >
        <Segmented
          block
          value={topicMode}
          options={[
            { label: t('webhook.topicMode.new'), value: 'new' },
            { label: t('webhook.topicMode.reuse'), value: 'reuse' },
          ]}
          onChange={(value) => setTopicMode(value as GenericWebhookTopicMode)}
        />
      </Field>
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Text weight={500}>{t('webhook.form.autoApprove.label')}</Text>
          <Switch checked={autoApprove} onChange={setAutoApprove} />
        </Flexbox>
        <span {...stylex.props(autoApprove ? styles.warning : styles.hint)}>
          {t(autoApprove ? 'webhook.form.autoApprove.onHint' : 'webhook.form.autoApprove.offHint')}
        </span>
      </Flexbox>
      <Button block loading={saving} type={'primary'} onClick={submit}>
        {t(item ? 'webhook.form.save' : 'webhook.form.create')}
      </Button>
    </Flexbox>
  );
};

/** Create a webhook for the agent, or edit one; `onSaved` gets the resulting row. */
export const openWebhookFormModal = (props: WebhookFormProps): ModalInstance =>
  createModal({
    content: <WebhookForm {...props} />,
    footer: null,
    maskClosable: true,
    styles: { content: { paddingBlock: 16, paddingInline: 24 } },
    title: translate(props.item ? 'webhook.form.editTitle' : 'webhook.form.createTitle', {
      ns: 'agent',
    }),
    width: 'min(90vw, 520px)',
  });
