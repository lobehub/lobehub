import {
  Block,
  Button,
  cssVar,
  Flexbox,
  Input,
  SliderWithInput,
  Tag,
  Text,
  TextArea,
} from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SettingCard from '@/components/SettingCard';
import ModelSelect from '@/features/ModelSelect';
import { useInitAgentConfig } from '@/hooks/useInitAgentConfig';
import { useAgentStore } from '@/store/agent';

import type { ProjectCoordinatorConfig } from './useCoordinatorConfig';
import { useSaveCoordinatorConfig } from './useCoordinatorConfig';

const TITLE_MAX = 255;
const DESCRIPTION_MAX = 1000;
const RESPONSIBILITY_MAX = 1000;

interface CardProps {
  config: ProjectCoordinatorConfig;
  disabled: boolean;
  projectId: string;
}

const SaveButton = ({
  disabled,
  loading,
  onClick,
}: {
  disabled: boolean;
  loading: boolean;
  onClick: () => void;
}) => {
  const { t } = useTranslation('common');

  return (
    <Button disabled={disabled || loading} loading={loading} type="primary" onClick={onClick}>
      {t('save')}
    </Button>
  );
};

const IdentityCard = ({ config, disabled, projectId }: CardProps) => {
  const { t } = useTranslation('project');
  const { save, saving } = useSaveCoordinatorConfig(projectId);
  const [title, setTitle] = useState(config.config.title ?? '');
  const [description, setDescription] = useState(config.config.description ?? '');
  const changed =
    title.trim() !== (config.config.title ?? '') ||
    description.trim() !== (config.config.description ?? '');

  return (
    <SettingCard
      description={t('coordinator.identity.description')}
      title={t('coordinator.identity.title')}
      action={
        <SaveButton
          disabled={disabled || !changed}
          loading={saving === 'identity'}
          onClick={() =>
            save('identity', {
              config: { description: description.trim() || null, title: title.trim() || null },
            })
          }
        />
      }
    >
      <Flexbox gap={12}>
        <Input
          aria-label={t('coordinator.identity.name')}
          disabled={disabled}
          maxLength={TITLE_MAX}
          placeholder={t('coordinator.identity.name')}
          style={{ maxWidth: 420 }}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextArea
          aria-label={t('coordinator.identity.summary')}
          autoSize={{ maxRows: 4, minRows: 2 }}
          disabled={disabled}
          maxLength={DESCRIPTION_MAX}
          placeholder={t('coordinator.identity.summary')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Flexbox>
    </SettingCard>
  );
};

const PromptCard = ({ config, disabled, projectId }: CardProps) => {
  const { t } = useTranslation('project');
  const { save, saving } = useSaveCoordinatorConfig(projectId);
  const [systemRole, setSystemRole] = useState(config.config.systemRole ?? '');

  return (
    <SettingCard
      description={t('coordinator.prompt.description')}
      hint={t('coordinator.prompt.hint', { count: systemRole.length })}
      title={t('coordinator.prompt.title')}
      action={
        <SaveButton
          disabled={disabled || systemRole === (config.config.systemRole ?? '')}
          loading={saving === 'prompt'}
          onClick={() => save('prompt', { config: { systemRole } })}
        />
      }
    >
      <TextArea
        aria-label={t('coordinator.prompt.title')}
        autoSize={{ maxRows: 20, minRows: 6 }}
        disabled={disabled}
        placeholder={t('coordinator.prompt.placeholder')}
        value={systemRole}
        onChange={(e) => setSystemRole(e.target.value)}
      />
    </SettingCard>
  );
};

const ResponsibilityCard = ({ config, disabled, projectId }: CardProps) => {
  const { t } = useTranslation('project');
  const { save, saving } = useSaveCoordinatorConfig(projectId);
  const [responsibility, setResponsibility] = useState(config.responsibility ?? '');

  return (
    <SettingCard
      description={t('coordinator.responsibility.description')}
      title={t('coordinator.responsibility.title')}
      action={
        <SaveButton
          disabled={disabled || responsibility.trim() === (config.responsibility ?? '')}
          loading={saving === 'responsibility'}
          onClick={() => save('responsibility', { responsibility: responsibility.trim() || null })}
        />
      }
    >
      <TextArea
        aria-label={t('coordinator.responsibility.title')}
        autoSize={{ maxRows: 6, minRows: 2 }}
        disabled={disabled}
        maxLength={RESPONSIBILITY_MAX}
        value={responsibility}
        onChange={(e) => setResponsibility(e.target.value)}
      />
    </SettingCard>
  );
};

type ModelParams = { temperature?: number; top_p?: number };

const readParams = (params: unknown): ModelParams => {
  const record = (params ?? {}) as Record<string, unknown>;
  return {
    temperature: typeof record.temperature === 'number' ? record.temperature : undefined,
    top_p: typeof record.top_p === 'number' ? record.top_p : undefined,
  };
};

const ModelCard = ({ config, disabled, projectId }: CardProps) => {
  const { t } = useTranslation('project');
  const { save, saving } = useSaveCoordinatorConfig(projectId);
  const saved = {
    model: config.config.model ?? '',
    provider: config.config.provider ?? '',
    ...readParams(config.config.params),
  };
  // An agent without its own model runs on the default the server merges in;
  // show that one rather than an empty picker.
  useInitAgentConfig(config.agentId);
  const effective = useAgentStore((s) => s.agentMap[config.agentId]);
  const inherited = !saved.model && effective?.model ? effective : undefined;
  const [draft, setDraft] = useState(saved);
  const shownModel = draft.model || inherited?.model || '';
  const shownProvider = draft.model ? draft.provider : inherited?.provider || '';
  const changed =
    draft.model !== saved.model ||
    draft.provider !== saved.provider ||
    draft.temperature !== saved.temperature ||
    draft.top_p !== saved.top_p;

  return (
    <SettingCard
      description={t('coordinator.model.description')}
      title={t('coordinator.model.title')}
      action={
        <SaveButton
          disabled={disabled || !changed}
          loading={saving === 'model'}
          onClick={() =>
            save('model', {
              config: {
                // Leave an inherited model inherited unless one was picked.
                ...(draft.model ? { model: draft.model, provider: draft.provider } : {}),
                params: { temperature: draft.temperature, top_p: draft.top_p },
              },
            })
          }
        />
      }
    >
      <Flexbox gap={16}>
        <Flexbox gap={6}>
          <Text type="secondary">{t('coordinator.model.model')}</Text>
          <ModelSelect
            disabled={disabled}
            style={{ maxWidth: 420, width: '100%' }}
            value={shownModel ? { model: shownModel, provider: shownProvider } : undefined}
            onChange={({ model, provider }) => setDraft((prev) => ({ ...prev, model, provider }))}
          />
          {shownProvider && (
            <Text fontSize={12} type="secondary">
              {draft.model
                ? t('coordinator.model.provider', { provider: shownProvider })
                : t('coordinator.model.inherited', { provider: shownProvider })}
            </Text>
          )}
        </Flexbox>
        <Flexbox gap={6}>
          <Text type="secondary">{t('coordinator.model.temperature')}</Text>
          <SliderWithInput
            disabled={disabled}
            max={2}
            min={0}
            step={0.1}
            value={draft.temperature ?? 1}
            onChange={(value) =>
              typeof value === 'number' && setDraft((prev) => ({ ...prev, temperature: value }))
            }
          />
        </Flexbox>
        <Flexbox gap={6}>
          <Text type="secondary">{t('coordinator.model.topP')}</Text>
          <SliderWithInput
            disabled={disabled}
            max={1}
            min={0}
            step={0.1}
            value={draft.top_p ?? 1}
            onChange={(value) =>
              typeof value === 'number' && setDraft((prev) => ({ ...prev, top_p: value }))
            }
          />
        </Flexbox>
      </Flexbox>
    </SettingCard>
  );
};

const OpeningCard = ({ config, disabled, projectId }: CardProps) => {
  const { t } = useTranslation('project');
  const { save, saving } = useSaveCoordinatorConfig(projectId);
  const savedQuestions = (config.config.openingQuestions ?? []).join('\n');
  const [message, setMessage] = useState(config.config.openingMessage ?? '');
  const [questions, setQuestions] = useState(savedQuestions);
  const changed = message !== (config.config.openingMessage ?? '') || questions !== savedQuestions;

  return (
    <SettingCard
      description={t('coordinator.opening.description')}
      title={t('coordinator.opening.title')}
      action={
        <SaveButton
          disabled={disabled || !changed}
          loading={saving === 'opening'}
          onClick={() =>
            save('opening', {
              config: {
                openingMessage: message.trim() || null,
                openingQuestions: questions
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              },
            })
          }
        />
      }
    >
      <Flexbox gap={12}>
        <TextArea
          aria-label={t('coordinator.opening.message')}
          autoSize={{ maxRows: 6, minRows: 2 }}
          disabled={disabled}
          placeholder={t('coordinator.opening.message')}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <TextArea
          aria-label={t('coordinator.opening.questions')}
          autoSize={{ maxRows: 6, minRows: 2 }}
          disabled={disabled}
          placeholder={t('coordinator.opening.questions')}
          value={questions}
          onChange={(e) => setQuestions(e.target.value)}
        />
      </Flexbox>
    </SettingCard>
  );
};

/** `telegram` → `Telegram`: the stored platform id, readable without loading every platform card. */
const formatPlatform = (platform: string) => platform.charAt(0).toUpperCase() + platform.slice(1);

/** The IM connections the project reads for its main agent; set up on the IM channels page. */
const ChannelSummaryCard = ({ config, onManage }: CardProps & { onManage: () => void }) => {
  const { t } = useTranslation('project');
  const providers = config.config.botProviders;

  return (
    <SettingCard
      action={<Button onClick={onManage}>{t('coordinator.channel.manage')}</Button>}
      description={t('coordinator.channel.description')}
      title={t('coordinator.channel.title')}
    >
      {providers.length === 0 ? (
        <Text type="secondary">{t('coordinator.channel.empty')}</Text>
      ) : (
        <Block padding={0} variant="outlined">
          {providers.map((provider, index) => (
            <Flexbox
              horizontal
              align="center"
              gap={12}
              justify="space-between"
              key={`${provider.platform}:${provider.applicationId}`}
              paddingBlock={12}
              paddingInline={16}
              style={index ? { borderTop: `1px solid ${cssVar.colorBorderSecondary}` } : undefined}
            >
              <Flexbox gap={2} style={{ minWidth: 0 }}>
                <Text weight={500}>{formatPlatform(provider.platform)}</Text>
                <Text ellipsis fontSize={12} type="secondary">
                  {t('coordinator.channel.applicationId', { id: provider.applicationId })}
                </Text>
              </Flexbox>
              <Tag color={provider.enabled ? 'success' : undefined}>
                {provider.enabled
                  ? t('coordinator.channel.enabled')
                  : t('coordinator.channel.disabled')}
              </Tag>
            </Flexbox>
          ))}
        </Block>
      )}
    </SettingCard>
  );
};

export const CoordinatorBasicSettings = ({
  onOpenChannels,
  ...props
}: CardProps & { onOpenChannels: () => void }) => (
  <Flexbox gap={16}>
    <PromptCard {...props} />
    <ModelCard {...props} />
    <ChannelSummaryCard {...props} onManage={onOpenChannels} />
    <ResponsibilityCard {...props} />
    <IdentityCard {...props} />
    <OpeningCard {...props} />
  </Flexbox>
);
