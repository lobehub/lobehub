'use client';

import { Button, Flexbox } from '@lobehub/ui';
import { useModalContext } from '@lobehub/ui/base-ui';
import { App } from 'antd';
import { type FC, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentEvalService } from '@/services/agentEval';
import { uploadService } from '@/services/upload';
import { type FileUploadState } from '@/types/files/upload';

import { getPresetById } from '../../config/datasetPresets';
import MappingStep, { autoInferMapping, type FieldMappingValue } from './MappingStep';
import UploadStep from './UploadStep';

type MappingTarget =
  | 'choices'
  | 'category'
  | 'expected'
  | 'ignore'
  | 'input'
  | 'metadata'
  | 'sortOrder';

export interface DatasetImportContentProps {
  datasetId: string;
  onSuccess?: (datasetId: string) => void;
  presetId?: string;
}

const DatasetImportContent: FC<DatasetImportContentProps> = ({
  datasetId,
  onSuccess,
  presetId,
}) => {
  const { t } = useTranslation('eval');
  const { close } = useModalContext();
  const { message } = App.useApp();

  const [step, setStep] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<FileUploadState>();

  const [pathname, setPathname] = useState('');
  const [filename, setFilename] = useState('');

  const [headers, setHeaders] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, any>[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [format, setFormat] = useState<'csv' | 'json' | 'jsonl' | 'xlsx'>();

  const [mapping, setMapping] = useState<Record<string, MappingTarget>>({});
  const [delimiter, setDelimiter] = useState('');

  const preset = useMemo(() => (presetId ? getPresetById(presetId) : undefined), [presetId]);

  const handleFileSelect = useCallback(
    async (file: File) => {
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
        setFormat(result.format as 'csv' | 'json' | 'jsonl' | 'xlsx');

        const inferred = autoInferMapping(result.headers, preset);
        setMapping(inferred);

        setStep(1);
      } catch {
        setTimeout(() => {
          message.error(t('dataset.import.parseError'));
        }, 0);
      } finally {
        setUploading(false);
        setUploadProgress(undefined);
      }
    },
    [message, preset, t],
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

  const handleImport = useCallback(async () => {
    const fieldMapping = buildFieldMapping();
    if (!fieldMapping) return;

    setImporting(true);
    try {
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
        message.success(t('dataset.import.success', { count: result.count }));
      }, 0);
      close();
      onSuccess?.(datasetId);
    } catch {
      setTimeout(() => {
        message.error(t('dataset.import.error'));
      }, 0);
    } finally {
      setImporting(false);
    }
  }, [buildFieldMapping, close, datasetId, filename, format, message, onSuccess, pathname, t]);

  const hasInputMapping = Object.values(mapping).includes('input');

  return (
    <Flexbox gap={16} paddingBlock={16} paddingInline={24}>
      <div>
        {step === 0 && (
          <UploadStep
            loading={uploading}
            preset={preset}
            uploadProgress={uploadProgress}
            onFileSelect={handleFileSelect}
          />
        )}

        {step === 1 && (
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
      </div>
      {step === 1 && (
        <Flexbox horizontal gap={8} justify="flex-end">
          <Button onClick={() => setStep(0)}>{t('dataset.import.prev')}</Button>
          <Button
            disabled={!hasInputMapping}
            loading={importing}
            type="primary"
            onClick={handleImport}
          >
            {t('dataset.import.confirm')}
          </Button>
        </Flexbox>
      )}
    </Flexbox>
  );
};

export default DatasetImportContent;
