'use client';

import type {
  AgentEvalDatasetPackageBindings,
  AgentEvalDatasetPackagePreview,
} from '@lobechat/types';
import { Alert, Flexbox, toast } from '@lobehub/ui';
import { type FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { hasPartialConnectorBindings } from '@/features/AgentEval/ConnectorBindings/bindings';
import { DatasetPackagePreview } from '@/features/AgentEval/DatasetPackagePreview';
import { datasetImportErrorMessage } from '@/features/AgentEval/DatasetPackagePreview/importError';
import { agentEvalService } from '@/services/agentEval';
import { uploadService } from '@/services/upload';
import { type FileUploadState } from '@/types/files/upload';

import { getPresetById } from '../../config/datasetPresets';
import MappingStep, { autoInferMapping, type FieldMappingValue } from './MappingStep';
import UploadStep from './UploadStep';

type MappingTarget =
  'choices' | 'category' | 'expected' | 'ignore' | 'input' | 'metadata' | 'sortOrder';

export interface DatasetImportContentProps {
  archiveOnly?: boolean;
  close: () => void;
  datasetId?: string;
  onImportReady: (api: { canImport: () => boolean; runImport: () => Promise<void> }) => void;
  onStateChange: (state: { busy: boolean; canImport: boolean; step: 0 | 1 }) => void;
  onSuccess?: (datasetId: string) => void;
  presetId?: string;
  setPrev: (fn: () => void) => void;
}

const DatasetImportContent: FC<DatasetImportContentProps> = ({
  archiveOnly,
  close,
  datasetId,
  onImportReady,
  onStateChange,
  onSuccess,
  presetId,
  setPrev,
}) => {
  const { t } = useTranslation('eval');

  const [step, setStep] = useState<0 | 1>(0);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  const [uploadProgress, setUploadProgress] = useState<FileUploadState>();

  const [pathname, setPathname] = useState('');
  const [filename, setFilename] = useState('');

  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, any>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [format, setFormat] = useState<'csv' | 'json' | 'jsonl' | 'xlsx' | 'zip'>();
  const [datasetPackage, setDatasetPackage] = useState<AgentEvalDatasetPackagePreview>();
  const [connectionBindings, setConnectionBindings] = useState<AgentEvalDatasetPackageBindings>({});
  const [packageName, setPackageName] = useState('');

  const [mapping, setMapping] = useState<Record<string, MappingTarget>>({});
  const [delimiter, setDelimiter] = useState('');

  const preset = useMemo(() => (presetId ? getPresetById(presetId) : undefined), [presetId]);

  const hasInputMapping = Object.values(mapping).includes('input');
  const canImport =
    format === 'zip'
      ? !!datasetPackage &&
        !hasPartialConnectorBindings(datasetPackage.connectionRequirements, connectionBindings) &&
        // An import only imports: a dataset of its own, in no benchmark.
        (!!datasetId || !!packageName.trim())
      : !!datasetId && hasInputMapping;

  useEffect(() => {
    onStateChange({ busy: uploading || importing, canImport, step });
  }, [canImport, importing, onStateChange, step, uploading]);

  useEffect(() => {
    setPrev(() => {
      setError(undefined);
      setStep(0);
    });
  }, [setPrev]);

  const handleFileSelect = useCallback(
    async (file: File) => {
      setError(undefined);
      const isArchive = file.name.toLowerCase().endsWith('.zip');
      if (archiveOnly && !isArchive) {
        setError(t('dataset.import.package.zipRequired'));
        return;
      }
      if (isArchive && file.size > 10 * 1024 * 1024) {
        setError(t('dataset.import.package.tooLarge'));
        return;
      }
      setUploading(true);
      setUploadProgress(undefined);
      try {
        const metadata = await uploadService.uploadToServerS3(file, {
          directory: 'eval-datasets',
          onProgress: (status, state) => {
            setUploadProgress(state);
          },
        });

        setPathname(metadata.path);
        setFilename(file.name);

        const result = await agentEvalService.parseDatasetFile({
          filename: file.name,
          pathname: metadata.path,
        });

        setHeaders(result.headers);
        setPreview(result.preview);
        setTotalCount(result.totalCount);
        setFormat(result.format === 'auto' ? undefined : result.format);
        if (result.format === 'zip') {
          setDatasetPackage(result.datasetPackage);
          setConnectionBindings({});
          setPackageName(result.datasetPackage.name);
        } else {
          setDatasetPackage(undefined);
          setMapping(autoInferMapping(result.headers, preset));
        }

        setStep(1);
      } catch (error) {
        setError(datasetImportErrorMessage(error, t('dataset.import.parseError')));
      } finally {
        setUploading(false);
        setUploadProgress(undefined);
      }
    },
    [archiveOnly, preset, t],
  );

  const buildFieldMapping = useCallback((): FieldMappingValue | null => {
    const inputCol = Object.entries(mapping).find(([, v]) => v === 'input')?.[0];
    if (!inputCol) return null;

    const expectedCol = Object.entries(mapping).find(([, v]) => v === 'expected')?.[0];
    const choicesCol = Object.entries(mapping).find(([, v]) => v === 'choices')?.[0];
    const categoryCol = Object.entries(mapping).find(([, v]) => v === 'category')?.[0];
    const sortOrderCol = Object.entries(mapping).find(([, v]) => v === 'sortOrder')?.[0];

    const metadataCols = Object.entries(mapping).filter(([, v]) => v === 'metadata');
    const metadataMap =
      metadataCols.length > 0
        ? Object.fromEntries(metadataCols.map(([col]) => [col, col]))
        : undefined;

    return {
      category: categoryCol,
      choices: choicesCol,
      expected: expectedCol,
      expectedDelimiter: delimiter || undefined,
      input: inputCol,
      metadata: metadataMap,
      sortOrder: sortOrderCol,
    };
  }, [mapping, delimiter]);

  const runImport = useCallback(async () => {
    if (!canImport) return;
    setError(undefined);
    setImporting(true);
    try {
      if (format === 'zip') {
        const result = await agentEvalService.importDatasetPackage({
          ...connectionBindings,
          ...(datasetId
            ? { datasetId }
            : {
                name: packageName.trim(),
              }),
          filename,
          pathname,
        });
        toast.success(t('dataset.import.success', { count: result.count }));
        close();
        onSuccess?.(result.datasetId);
        return;
      }
      const fieldMapping = buildFieldMapping();
      if (!fieldMapping || !datasetId) return;
      const result = await agentEvalService.importDataset({
        datasetId,
        fieldMapping: {
          category: fieldMapping.category,
          choices: fieldMapping.choices,
          expected: fieldMapping.expected,
          expectedDelimiter: fieldMapping.expectedDelimiter,
          input: fieldMapping.input,
          metadata: fieldMapping.metadata,
          sortOrder: fieldMapping.sortOrder,
        },
        filename,
        format,
        pathname,
      });
      setTimeout(() => {
        toast.success(t('dataset.import.success', { count: result.count }));
      }, 0);
      close();
      onSuccess?.(datasetId);
    } catch (error) {
      setError(datasetImportErrorMessage(error, t('dataset.import.error')));
    } finally {
      setImporting(false);
    }
  }, [
    buildFieldMapping,
    canImport,
    close,
    connectionBindings,
    datasetId,
    filename,
    format,
    onSuccess,
    packageName,
    pathname,
    t,
  ]);

  useEffect(() => {
    onImportReady({
      canImport: () => canImport,
      runImport,
    });
  }, [canImport, onImportReady, runImport]);

  return (
    <Flexbox gap={16}>
      {error && <Alert title={error} type="error" />}
      {step === 0 && (
        <UploadStep
          archiveOnly={archiveOnly}
          loading={uploading}
          preset={preset}
          uploadProgress={uploadProgress}
          onFileSelect={handleFileSelect}
        />
      )}

      {step === 1 && datasetPackage && format === 'zip' && (
        <DatasetPackagePreview
          bindings={connectionBindings}
          datasetId={datasetId}
          disabled={importing}
          existingDataset={!!datasetId}
          name={packageName}
          preview={datasetPackage}
          samples={preview}
          onBindingsChange={setConnectionBindings}
          onNameChange={setPackageName}
        />
      )}
      {step === 1 && format !== 'zip' && (
        <MappingStep
          delimiter={delimiter}
          headers={headers}
          mapping={mapping}
          preview={preview}
          totalCount={totalCount}
          onDelimiterChange={setDelimiter}
          onMappingChange={setMapping}
        />
      )}
    </Flexbox>
  );
};

export default DatasetImportContent;
