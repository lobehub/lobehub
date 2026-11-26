'use client';

import {
  Button,
  createModal,
  Flexbox,
  Input,
  InputPassword,
  Select,
  Spin,
  Switch,
  Text,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import KeyValueEditor from '@/components/KeyValueEditor';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

type Connection = Awaited<ReturnType<typeof agentEvalService.getEvalConnector>>;
interface EditorProps {
  datasetId: string;
  id?: string;
  onSaved: () => Promise<unknown>;
}

const ConnectionForm = ({
  datasetId,
  connection,
  onSaved,
}: Omit<EditorProps, 'id'> & { connection?: Connection }) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const formId = useId();
  const [connectionId, setConnectionId] = useState(connection?.id);
  const [name, setName] = useState(connection?.name ?? '');
  const [enabled, setEnabled] = useState(connection?.isEnabled ?? true);
  const [url, setUrl] = useState(connection?.mcpServerUrl ?? '');
  const [auth, setAuth] = useState(connection?.hasCredentials ? 'keep' : 'none');
  const [token, setToken] = useState('');
  const [headers, setHeaders] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<'save' | 'test'>();
  const [error, setError] = useState<unknown>();
  const [tested, setTested] = useState<number>();
  const needsAuth = auth === 'keep' && url !== connection?.mcpServerUrl;
  const invalid = !name.trim() || !url.trim() || needsAuth || (auth === 'bearer' && !token);

  const save = async (test: boolean) => {
    setPending(test ? 'test' : 'save');
    setError(undefined);
    setTested(undefined);
    try {
      const saved = await agentEvalService.saveEvalConnector({
        credentials:
          auth === 'keep'
            ? undefined
            : auth === 'none'
              ? null
              : auth === 'bearer'
                ? { token, type: 'bearer' }
                : { headers, type: 'header' },
        datasetId,
        id: connectionId,
        isEnabled: enabled,
        mcpServerUrl: url.trim(),
        name: name.trim(),
      });
      setConnectionId(saved.id);
      await onSaved();
      if (test) {
        const result = await agentEvalService.testEvalConnector(datasetId, saved.id);
        setTested(result.toolCount);
        await onSaved();
      } else {
        toast.success(t('connections.saved'));
        close();
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(undefined);
    }
  };

  return (
    <Flexbox gap={16}>
      <Text type="secondary">{t('connections.editHint')}</Text>
      <Flexbox horizontal align="center" gap={12} justify="space-between">
        <label htmlFor={`${formId}-enabled`}>{t('connections.enabled')}</label>
        <Switch
          checked={enabled}
          disabled={!!pending}
          id={`${formId}-enabled`}
          onChange={setEnabled}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <label htmlFor={`${formId}-name`}>{t('connections.name')}</label>
        <Input
          disabled={!!pending}
          id={`${formId}-name`}
          maxLength={255}
          value={name}
          onChange={(e) => {
            setTested(undefined);
            setName(e.target.value);
          }}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <label htmlFor={`${formId}-url`}>{t('connections.url')}</label>
        <Input
          disabled={!!pending}
          id={`${formId}-url`}
          value={url}
          onChange={(e) => {
            setTested(undefined);
            setUrl(e.target.value);
          }}
        />
      </Flexbox>
      <Flexbox gap={6}>
        <label htmlFor={`${formId}-auth`}>{t('connections.authentication')}</label>
        <Select
          disabled={!!pending}
          id={`${formId}-auth`}
          value={auth}
          options={[
            ...(connection?.hasCredentials
              ? [{ label: t('connections.keepAuth'), value: 'keep' }]
              : []),
            { label: t('connections.clearAuth'), value: 'none' },
            { label: t('connections.bearerAuth'), value: 'bearer' },
            { label: t('connections.headerAuth'), value: 'header' },
          ]}
          onChange={(value) => {
            setTested(undefined);
            setAuth(String(value));
          }}
        />
        {needsAuth && <Text type="danger">{t('connections.replaceAuth')}</Text>}
        {auth === 'bearer' && (
          <InputPassword
            aria-label={t('connections.bearerAuth')}
            autoComplete="new-password"
            disabled={!!pending}
            value={token}
            onChange={(e) => {
              setTested(undefined);
              setToken(e.target.value);
            }}
          />
        )}
        {auth === 'header' && (
          <KeyValueEditor
            disabled={!!pending}
            value={headers}
            onChange={(value) => {
              setTested(undefined);
              setHeaders(value);
            }}
          />
        )}
      </Flexbox>
      {!!error && <AsyncError error={error} variant="inline" />}
      {tested !== undefined && <Text>{t('connections.tested', { count: tested })}</Text>}
      <Flexbox horizontal gap={8} justify="flex-end" wrap="wrap">
        <Button disabled={!!pending} onClick={close}>
          {t('connections.cancel')}
        </Button>
        <Button
          disabled={invalid || !!pending}
          loading={pending === 'test'}
          onClick={() => void save(true)}
        >
          {t('connections.saveAndTest')}
        </Button>
        <Button
          disabled={invalid || !!pending}
          loading={pending === 'save'}
          type="primary"
          onClick={() => void save(false)}
        >
          {t('connections.save')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

const ConnectionEditor = (props: EditorProps) => {
  const fetchConnection = useEvalStore((s) => s.useFetchEvalConnector);
  const { data, error, isLoading, mutate } = fetchConnection(props.datasetId, props.id);
  if (props.id && isLoading) return <Spin />;
  if (error) return <AsyncError error={error} onRetry={() => void mutate()} />;
  if (props.id && !data) return null;
  return (
    <ConnectionForm
      {...props}
      connection={data}
      onSaved={async () => {
        await Promise.all([props.onSaved(), props.id ? mutate() : Promise.resolve()]);
      }}
    />
  );
};

export const openConnectionEditor = (props: EditorProps & { title: string }) =>
  createModal({
    content: <ConnectionEditor {...props} />,
    footer: null,
    maskClosable: false,
    title: props.title,
    width: 640,
  });
