'use client';

import type { AgentEvalDatasetPackageBindings } from '@lobechat/types';
import { Block, Button, Flexbox, Modal, Spin, Text, toast } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AsyncError from '@/components/AsyncError';
import { agentEvalService } from '@/services/agentEval';
import { useEvalStore } from '@/store/eval';

import { hasPartialConnectorBindings } from './bindings';
import { ConnectorBindings } from './index';

type Requirements = Awaited<
  ReturnType<typeof agentEvalService.getDatasetConnectorBindings>
>['requirements'];

const DatasetConnectionsEditor = ({
  datasetId,
  onClose,
  onSaved,
  requirements,
}: {
  datasetId: string;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
  requirements: Requirements;
}) => {
  const { t } = useTranslation('eval');
  const [value, setValue] = useState<AgentEvalDatasetPackageBindings>(() => ({
    caseBindings: Object.fromEntries(
      requirements.filter((r) => r.scope === 'case').map((r) => [r.key, r.bindings]),
    ),
    environmentBindings: Object.fromEntries(
      requirements.filter((r) => r.scope === 'environment').map((r) => [r.key, r.bindings]),
    ),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>();
  const changes: AgentEvalDatasetPackageBindings = {};
  for (const requirement of requirements) {
    const scope = requirement.scope === 'environment' ? 'environmentBindings' : 'caseBindings';
    const next = value[scope]?.[requirement.key] ?? {};
    if (JSON.stringify(next) !== JSON.stringify(requirement.bindings)) {
      changes[scope] = { ...changes[scope], [requirement.key]: next };
    }
  }
  const partial = hasPartialConnectorBindings(requirements, changes);
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await agentEvalService.updateDatasetConnectorBindings({ datasetId, ...changes });
      await onSaved();
      toast.success(t('connections.saved'));
      onClose();
    } catch (cause) {
      setError(cause);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      closable={!saving}
      keyboard={!saving}
      maskClosable={false}
      title={t('connections.title')}
      width={640}
      footer={
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button disabled={saving} onClick={onClose}>
            {t('connections.cancel')}
          </Button>
          <Button disabled={partial} loading={saving} type="primary" onClick={() => void save()}>
            {t('connections.save')}
          </Button>
        </Flexbox>
      }
      onCancel={onClose}
    >
      <Flexbox gap={12}>
        <Text type="secondary">{t('connections.editHint')}</Text>
        {!!error && <AsyncError error={error} variant="inline" />}
        {partial && <Text type="danger">{t('connections.completeScope')}</Text>}
        <ConnectorBindings
          disabled={saving}
          requirements={requirements}
          value={value}
          onChange={setValue}
        />
      </Flexbox>
    </Modal>
  );
};

export const DatasetConnections = ({
  datasetId,
  editable,
}: {
  datasetId: string;
  editable: boolean;
}) => {
  const { t } = useTranslation('eval');
  const [editing, setEditing] = useState(false);
  const [fetchBindings, fetchConnectors] = useEvalStore((s) => [
    s.useFetchDatasetConnectorBindings,
    s.useFetchEvalConnectors,
  ]);
  const { data, error, isLoading, mutate } = fetchBindings(datasetId);
  const { data: connectors, error: connectorError, mutate: refreshConnectors } = fetchConnectors();
  if (isLoading) return <Spin />;
  if (error) return <AsyncError error={error} variant="inline" onRetry={() => void mutate()} />;
  if (!data?.requirements.length) return null;
  const missing =
    connectors &&
    data.requirements.reduce(
      (count, requirement) =>
        count +
        requirement.services.filter(
          (service) =>
            !connectors.some(
              (connection) => connection.id === requirement.bindings[service]?.connectorId,
            ),
        ).length,
      0,
    );
  return (
    <Block padding={16} variant="outlined">
      <Flexbox gap={8}>
        <Flexbox horizontal align="center" gap={12} justify="space-between" wrap="wrap">
          <Flexbox gap={4}>
            <Text weight={600}>{t('connections.title')}</Text>
            <Text type="secondary">
              {missing === undefined
                ? t('connections.checking')
                : missing
                  ? t('connections.missing', { count: missing })
                  : t('connections.configured')}
            </Text>
          </Flexbox>
          {editable && <Button onClick={() => setEditing(true)}>{t('connections.manage')}</Button>}
        </Flexbox>
        {connectorError && (
          <AsyncError
            error={connectorError}
            variant="inline"
            onRetry={() => void refreshConnectors()}
          />
        )}
        <Text fontSize={13} type="secondary">
          {t('connections.datasetHint')}
        </Text>
        {editing && (
          <DatasetConnectionsEditor
            datasetId={datasetId}
            requirements={data.requirements}
            onClose={() => setEditing(false)}
            onSaved={async () => {
              await Promise.all([mutate(), refreshConnectors()]);
            }}
          />
        )}
      </Flexbox>
    </Block>
  );
};
