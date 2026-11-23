'use client';

import type {
  GenericWebhookTopicMode,
  InboundWebhookItem,
  InboundWebhookItemWithSecret,
} from '@lobechat/types';
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

import InlineErrorText from '@/components/InlineErrorText';
import { type InlineErrorState, toInlineError } from '@/components/InlineErrorText/errorDetail';
import { inboundWebhookService } from '@/services/inboundWebhook';

import { KeyReveal } from './KeyReveal';
import TopicPicker from './TopicPicker';
import type { WebhookTopicOption } from './useWebhookTopics';

const styles = stylex.create({
  hint: { fontSize: '12px', lineHeight: 1.5, color: cssVar.colorTextSecondary },
  successIcon: { color: cssVar.colorSuccess },
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
  // The topic a `reuse` webhook continues; the row carries it as `topic` when one was picked.
  const [topic, setTopic] = useState<WebhookTopicOption | undefined>(
    source?.topicId && item?.topic ? item.topic : undefined,
  );
  const [saving, setSaving] = useState(false);
  /** Save/create failure, shown above the submit button: the modal stays open with the user's input. */
  const [error, setError] = useState<InlineErrorState | null>(null);
  // Set once a new webhook exists; the modal then shows its URL and its key, this one time.
  const [created, setCreated] = useState<InboundWebhookItemWithSecret>();

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const settings = {
        autoApprove,
        instructions,
        name,
        topicId: topicMode === 'reuse' ? (topic?.id ?? null) : null,
        topicMode,
      };
      if (item) {
        onSaved(await inboundWebhookService.update(item.id, settings));
        toast.success(t('webhook.form.saved'));
        close();
      } else {
        const next = await inboundWebhookService.create(agentId, settings);
        onSaved(next.item);
        setCreated(next);
      }
    } catch (err) {
      console.error(err);
      setError(
        toInlineError(t(item ? 'webhook.form.saveFailed' : 'webhook.form.createFailed'), err),
      );
    } finally {
      setSaving(false);
    }
  };

  if (created?.item.endpoint) {
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
        <KeyReveal endpoint={created.item.endpoint} secret={created.secret} />
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
      {topicMode === 'reuse' && (
        <Field hint={t('webhook.topic.hint')} label={t('webhook.topic.label')}>
          <TopicPicker agentId={agentId} value={topic} onChange={setTopic} />
        </Field>
      )}
      <Flexbox gap={6}>
        <Flexbox horizontal align={'center'} gap={12} justify={'space-between'}>
          <Text weight={500}>{t('webhook.form.autoApprove.label')}</Text>
          <Switch checked={autoApprove} onChange={setAutoApprove} />
        </Flexbox>
        <span {...stylex.props(autoApprove ? styles.warning : styles.hint)}>
          {t(autoApprove ? 'webhook.form.autoApprove.onHint' : 'webhook.form.autoApprove.offHint')}
        </span>
      </Flexbox>
      {error && <InlineErrorText detail={error.detail}>{error.summary}</InlineErrorText>}
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
    // After creating, the modal holds the key, shown once: only its button closes it then.
    maskClosable: !!props.item,
    styles: { content: { paddingBlock: 16, paddingInline: 24 } },
    title: translate(props.item ? 'webhook.form.editTitle' : 'webhook.form.createTitle', {
      ns: 'agent',
    }),
    width: 'min(90vw, 520px)',
  });
