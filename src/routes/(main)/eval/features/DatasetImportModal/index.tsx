'use client';

import { Modal } from '@lobehub/ui';
import { App } from 'antd';
import { memo, useCallback, useMemo, useState } from 'react';
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

interface DatasetImportModalProps {
  datasetId: string;
  onClose: () => void;
  onSuccess?: (datasetId: string) => void;
  open: boolean;
  presetId?: string;
}

const DatasetImportModal = memo<DatasetImportModalProps>(
  ({ open, onClose, datasetId, onSuccess, presetId }) => {
    const { t } = useTranslation('eval');
    const { message } = App.useApp();

    const [step, setStep] = useState(0);
    const [uploading, setUploading] = useState(false);
    const [importing, setImporting] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<FileUploadState>();

    // Upload result
    const [pathname, setPathname] = useState('');
    const [filename, setFilename] = useState('');

    // Parse result
    const [headers, setHeaders] = useState<string[]>([]);
    const [preview, setPreview] = useState<Record<string, any>[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [format, setFormat] = useState<'csv' | 'json' | 'jsonl' | 'xlsx'>();

    // Mapping state
    const [mapping, setMapping] = useState<Record<string, MappingTarget>>({});
    const [delimiter, setDelimiter] = useState('');

    const preset = useMemo(() => (presetId ? getPresetById(presetId) : undefined), [presetId]);

    const reset = useCallback(() => {
      setStep(0);
      setUploading(false);
      setImporting(false);
      setUploadProgress(undefined);
      setPathname('');
      setFilename('');
      setHeaders([]);
      setPreview([]);
      setTotalCount(0);
      setFormat(undefined);
      setMapping({});
      setDelimiter('');
    }, []);

    const handleClose = useCallback(() => {
      reset();
      onClose();
    }, [onClose, reset]);

    const handleFileSelect = useCallback(
      async (file: File) => {
        setUploading(true);
        setUploadProgress(undefined);
        try {
          // 1. Upload to S3 with progress tracking
          const metadata = await uploadService.uploadToServerS3(file, {
            directory: 'eval-datasets',
            onProgress: (status, state) => {
              setUploadProgress(state);
            },
          });

          setPathname(metadata.path);
          setFilename(file.name);

          // 2. Parse the file on server
          const result = await agentEvalService.parseDatasetFile({
            pathname: metadata.path,
            filename: file.name,
          });

          setHeaders(result.headers);
          setPreview(result.preview);
          setTotalCount(result.totalCount);
          setFormat(result.format as 'csv' | 'json' | 'jsonl' | 'xlsx');

          // 3. Auto-infer field mapping using preset
          const inferred = autoInferMapping(result.headers, preset);
          setMapping(inferred);

          // 4. Advance to mapping step
          setStep(1);
        } catch {
          // Use setTimeout to avoid calling message during render
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
          pathname,
          filename,
          format,
          fieldMapping: {
            input: fieldMapping.input,
            expected: fieldMapping.expected,
            expectedDelimiter: fieldMapping.expectedDelimiter,
            choices: fieldMapping.choices,
            category: fieldMapping.category,
            sortOrder: fieldMapping.sortOrder,
            metadata: fieldMapping.metadata,
          },
        });
        setTimeout(() => {
          message.success(t('dataset.import.success', { count: result.count }));
        }, 0);
        handleClose();
        onSuccess?.(datasetId);
      } catch {
        setTimeout(() => {
          message.error(t('dataset.import.error'));
        }, 0);
      } finally {
        setImporting(false);
      }
    }, [
      buildFieldMapping,
      datasetId,
      filename,
      format,
      handleClose,
      message,
      onSuccess,
      pathname,
      t,
    ]);

    const hasInputMapping = Object.values(mapping).includes('input');

    return (
      <Modal
        allowFullscreen
        destroyOnHidden
        cancelText={step === 1 ? t('dataset.import.prev') : undefined}
        centered={step === 1}
        footer={step === 0 ? null : undefined}
        maskClosable={false}
        okText={step === 1 ? t('dataset.import.confirm') : undefined}
        open={open}
        title={t('dataset.import.title')}
        width={step === 0 ? 720 : '98vw'}
        okButtonProps={{
          disabled: !hasInputMapping,
          loading: importing,
        }}
        styles={
          step === 1
            ? {
                container: { height: '95vh', display: 'flex', flexDirection: 'column' },
                body: { overflow: 'auto', maxHeight: 'unset', flex: 1 },
              }
            : undefined
        }
        onCancel={step === 1 ? () => setStep(0) : handleClose}
        onOk={step === 1 ? handleImport : undefined}
      >
        <div style={{ paddingBlock: 16 }}>
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
      </Modal>
    );
  },
);

export default DatasetImportModal;
