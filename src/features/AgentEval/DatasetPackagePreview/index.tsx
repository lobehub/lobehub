'use client';

import type {
  AgentEvalDatasetPackageBindings,
  AgentEvalDatasetPackagePreview,
} from '@lobechat/types';
import { Accordion, Flexbox, Input, Tag, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
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
});

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

      {!!preview.embeddedConnections?.length && (
        <Flexbox gap={8}>
          <Text weight={500}>{t('connections.included')}</Text>
          <Text fontSize={13} type="secondary">
            {t('connections.autoImport')}
          </Text>
          {preview.embeddedConnections.map((connection) => (
            <Flexbox horizontal gap={8} key={connection.key} wrap="wrap">
              <Text>{connection.name}</Text>
              <Tag>
                {t(connection.authConfigured ? 'connections.authIncluded' : 'connections.noAuth')}
              </Tag>
            </Flexbox>
          ))}
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
