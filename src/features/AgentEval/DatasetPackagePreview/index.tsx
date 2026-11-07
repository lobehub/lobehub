'use client';

import {
  type AgentEvalDatasetPackageBindings,
  type AgentEvalDatasetPackagePreview,
  DATASET_PACKAGE_MAX_CONNECTIONS,
} from '@lobechat/types';
import { Accordion, Button, Flexbox, Input, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConnectorBindings } from '@/features/AgentEval/ConnectorBindings';
import { hasPartialConnectorBindings } from '@/features/AgentEval/ConnectorBindings/bindings';

const styles = stylex.create({
  sample: {
    borderBlockStartWidth: 1,
    borderBlockStartStyle: 'solid',
    borderBlockStartColor: cssVar.colorBorderSecondary,
    paddingBlockStart: 12,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  samples: { maxHeight: 200, overflowY: 'auto' },
  connections: { maxHeight: 240, overflowY: 'auto' },
});

/** Connections listed before "Show all"; the rest stay one click away. */
const CONNECTIONS_PREVIEW = 5;

interface DatasetPackagePreviewProps {
  bindings: AgentEvalDatasetPackageBindings;
  datasetId?: string;
  disabled?: boolean;
  existingDataset?: boolean;
  name: string;
  onBindingsChange: (bindings: AgentEvalDatasetPackageBindings) => void;
  onNameChange: (name: string) => void;
  preview: AgentEvalDatasetPackagePreview;
  samples: Array<{ input?: unknown }>;
}

/** A structured package already contains its case fields, rules and environments. */
export const DatasetPackagePreview = ({
  bindings,
  onBindingsChange,
  datasetId,
  disabled,
  existingDataset,
  name,
  onNameChange,
  preview,
  samples,
}: DatasetPackagePreviewProps) => {
  const { t } = useTranslation('eval');
  const id = useId();
  const [showAllConnections, setShowAllConnections] = useState(false);
  const connections = preview.embeddedConnections ?? [];
  const shownConnections = showAllConnections
    ? connections
    : connections.slice(0, CONNECTIONS_PREVIEW);
  const withCredentials = connections.filter((connection) => connection.authConfigured).length;

  return (
    <Flexbox gap={20}>
      <Flexbox gap={8}>
        <Text weight={600}>{t('dataset.import.package.preview')}</Text>
        {preview.description && <Text type="secondary">{preview.description}</Text>}
        <Flexbox horizontal gap={8} wrap="wrap">
          <Tag>{t('dataset.import.package.cases', { count: preview.caseCount })}</Tag>
          <Tag>{t('dataset.import.package.environments', { count: preview.environmentCount })}</Tag>
          {preview.release && (
            <Tag>{t('lobeBench.dataset.release', { release: preview.release })}</Tag>
          )}
        </Flexbox>
        <Text fontSize={13} type="secondary">
          {t('dataset.import.package.preserved')}
        </Text>
        {preview.mockServices.length > 0 && (
          <Text fontSize={13} type="secondary">
            {t('dataset.import.package.mockServices', {
              services: preview.mockServices.join(', '),
            })}
          </Text>
        )}
      </Flexbox>

      {connections.length > 0 && (
        <Flexbox gap={8}>
          <Text weight={500}>{t('connections.includedCount', { count: connections.length })}</Text>
          <Text fontSize={13} type="secondary">
            {t('connections.autoImport')}{' '}
            {t('connections.includedSummary', {
              count: connections.length,
              max: DATASET_PACKAGE_MAX_CONNECTIONS,
              withCredentials,
            })}
          </Text>
          {/* However many the ZIP holds, the dialog lists a few and scrolls the rest. */}
          <Flexbox
            className={stylex.props(styles.connections).className}
            gap={6}
            id={`${id}-connections`}
          >
            {shownConnections.map((connection) => (
              <Flexbox horizontal align="center" gap={8} key={connection.key}>
                <Text ellipsis style={{ minWidth: 0 }}>
                  {connection.name}
                </Text>
                <Tag style={{ flexShrink: 0 }}>
                  {t(connection.authConfigured ? 'connections.authIncluded' : 'connections.noAuth')}
                </Tag>
              </Flexbox>
            ))}
          </Flexbox>
          {connections.length > CONNECTIONS_PREVIEW && (
            <Button
              aria-controls={`${id}-connections`}
              aria-expanded={showAllConnections}
              size="small"
              style={{ alignSelf: 'flex-start', paddingInline: 0 }}
              type="link"
              onClick={() => setShowAllConnections((value) => !value)}
            >
              {showAllConnections
                ? t('connections.showFewer')
                : t('connections.showAll', { count: connections.length })}
            </Button>
          )}
          {!existingDataset && (
            <Text fontSize={13} type="secondary">
              {t('connections.undoImport')}
            </Text>
          )}
        </Flexbox>
      )}
      {preview.connectionRequirements.some((requirement) =>
        requirement.services.some((service) => !requirement.providedServices?.includes(service)),
      ) && <Text type="secondary">{t('connections.importLater')}</Text>}
      {preview.connectionRequirements.some(
        (requirement) => !requirement.providedServices?.length,
      ) && (
        <Flexbox gap={8}>
          {hasPartialConnectorBindings(preview.connectionRequirements, bindings) && (
            <Text type="danger">{t('connections.completeScope')}</Text>
          )}
          <Accordion
            items={[
              {
                key: 'connections',
                title: t('connections.optional'),
                children: (
                  <ConnectorBindings
                    datasetId={datasetId}
                    disabled={disabled}
                    value={bindings}
                    requirements={preview.connectionRequirements.filter(
                      (requirement) => !requirement.providedServices?.length,
                    )}
                    onChange={onBindingsChange}
                  />
                ),
              },
            ]}
          />
        </Flexbox>
      )}

      {!existingDataset && (
        <>
          <Flexbox gap={8}>
            <label htmlFor={`${id}-name`}>{t('dataset.import.package.name')}</label>
            <Input
              disabled={disabled}
              id={`${id}-name`}
              maxLength={200}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
          </Flexbox>
        </>
      )}

      <Flexbox gap={12}>
        <Text weight={500}>{t('dataset.import.preview')}</Text>
        <Flexbox className={stylex.props(styles.samples).className} gap={12}>
          {samples.slice(0, 3).map((sample, index) => (
            <Text className={stylex.props(styles.sample).className} fontSize={13} key={index}>
              {String(sample.input ?? '')}
            </Text>
          ))}
        </Flexbox>
        <Text fontSize={13} type="secondary">
          {t('dataset.import.package.history')}
        </Text>
      </Flexbox>
    </Flexbox>
  );
};
