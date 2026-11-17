'use client';

import type {
  BatchImportCandidate,
  BatchImportConflictStrategy,
  BatchImportPreview,
  BatchImportResult,
} from '@lobechat/types';
import { MAX_BATCH_IMPORT_SKILLS } from '@lobechat/types';
import {
  Alert,
  Block,
  Button,
  Checkbox,
  createModal,
  Flexbox,
  Icon,
  type ModalInstance,
  ScrollArea,
  Segmented,
  Spin,
  Tag,
  Text,
  toast,
  Upload,
  useModalContext,
} from '@lobehub/ui';
import { sha256 } from 'js-sha256';
import { ArrowLeftRight, InboxIcon, Layers, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePermission } from '@/hooks/usePermission';
import { lambdaClient } from '@/libs/trpc/client/lambda';
import { fileService } from '@/services/file';
import { uploadService } from '@/services/upload';
import { useToolStore } from '@/store/tool';

type BatchStep = 'preview' | 'result' | 'upload';

/** `''` is the archive root; use a readable key for the selection records. */
const candidateKey = (path: string) => path || '/';

const resultTagColors: Record<
  BatchImportResult['results'][number]['status'],
  'error' | 'info' | 'success' | 'warning'
> = {
  created: 'success',
  failed: 'error',
  skipped: 'info',
  unchanged: 'info',
  updated: 'warning',
};

export const BatchImportContent = () => {
  const { t } = useTranslation(['setting', 'common']);
  const { close, setCanDismissByClickOutside } = useModalContext();

  const importAgentSkillsFromZipBatch = useToolStore((s) => s.importAgentSkillsFromZipBatch);
  const previewAgentSkillBatchImport = useToolStore((s) => s.previewAgentSkillBatchImport);
  const { allowed: canCreate } = usePermission('create_content');

  const [step, setStep] = useState<BatchStep>('upload');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<BatchImportCandidate[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [strategies, setStrategies] = useState<Record<string, BatchImportConflictStrategy>>({});
  const [defaultStrategy, setDefaultStrategy] = useState<BatchImportConflictStrategy>('skip');
  const [result, setResult] = useState<BatchImportResult | null>(null);

  /** The uploaded archive stays needed until the import request finishes. */
  const pendingFileIdRef = useRef<string | undefined>(undefined);
  /** The server may still be reading the archive; never delete it in flight. */
  const importingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    setCanDismissByClickOutside(!loading && !importing);
  }, [loading, importing, setCanDismissByClickOutside]);

  // Closing before the import finishes must not leave the uploaded archive
  // behind in the user's files.
  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      const fileId = pendingFileIdRef.current;
      if (!fileId || importingRef.current) return;
      pendingFileIdRef.current = undefined;
      void fileService.removeUnreferencedFile(fileId).catch(() => {});
    };
  }, []);

  const discardPendingFile = () => {
    const fileId = pendingFileIdRef.current;
    pendingFileIdRef.current = undefined;
    if (fileId) void fileService.removeUnreferencedFile(fileId).catch(() => {});
  };

  const enterPreview = (preview: BatchImportPreview) => {
    const nextSelected: Record<string, boolean> = {};
    const nextStrategies: Record<string, BatchImportConflictStrategy> = {};

    for (const candidate of preview.candidates) {
      const key = candidateKey(candidate.path);
      nextSelected[key] = !candidate.error;
      // Never replace an installed skill unless the user asks for it.
      nextStrategies[key] = 'skip';
    }

    setCandidates(preview.candidates);
    setSelected(nextSelected);
    setStrategies(nextStrategies);
    setDefaultStrategy('skip');
    setError(null);
    setStep('preview');
  };

  const handleUpload = async (file: File) => {
    if (!canCreate) return;

    setLoading(true);
    setError(null);
    let uploadedPathname: string | undefined;
    let createdFileId: string | undefined;

    try {
      const { data: metadata } = await uploadService.uploadFileToS3(file, {
        directory: 'skills',
      });
      uploadedPathname = metadata.path;

      const hash = sha256(await file.arrayBuffer());
      const created = await lambdaClient.file.createFile.mutate({
        fileType: file.type || 'application/zip',
        hash,
        metadata: {},
        name: file.name,
        size: file.size,
        url: metadata.path,
      });
      uploadedPathname = undefined;
      createdFileId = created.id;
      pendingFileIdRef.current = created.id;

      const preview = await previewAgentSkillBatchImport({ zipFileId: created.id });
      if (!preview) throw new Error(t('agentSkillModal.batch.readError'));

      if (preview.candidates.length === 0) {
        throw new Error(t('agentSkillModal.batch.preview.empty'));
      }

      enterPreview(preview);
      // The modal may have been closed while the preview request was running.
      if (!mountedRef.current) discardPendingFile();
    } catch (uploadError: any) {
      if (uploadedPathname) await uploadService.releaseUpload(uploadedPathname);
      if (createdFileId) {
        pendingFileIdRef.current = undefined;
        void fileService.removeUnreferencedFile(createdFileId).catch(() => {});
      }
      setError(uploadError?.message || String(uploadError));
    } finally {
      setLoading(false);
    }
  };

  const selectable = candidates.filter((candidate) => !candidate.error);
  const selectedCount = selectable.filter(
    (candidate) => selected[candidateKey(candidate.path)],
  ).length;
  const allSelected = selectable.length > 0 && selectedCount === selectable.length;
  const indeterminate = selectedCount > 0 && selectedCount < selectable.length;

  const handleToggleAll = (checked?: boolean) => {
    setSelected((previous) => {
      const next = { ...previous };
      for (const candidate of selectable) next[candidateKey(candidate.path)] = checked !== false;
      return next;
    });
  };

  const handleDefaultStrategy = (strategy: BatchImportConflictStrategy) => {
    setDefaultStrategy(strategy);
    setStrategies((previous) => {
      const next = { ...previous };
      for (const candidate of candidates) {
        if (candidate.conflict || candidate.duplicateOf !== undefined) {
          next[candidateKey(candidate.path)] = strategy;
        }
      }
      return next;
    });
  };

  const handleBack = () => {
    discardPendingFile();
    setCandidates([]);
    setSelected({});
    setStrategies({});
    setResult(null);
    setError(null);
    setStep('upload');
  };

  const handleImport = async () => {
    const fileId = pendingFileIdRef.current;
    if (!fileId || importing || selectedCount === 0) return;

    importingRef.current = true;
    setImporting(true);
    setError(null);

    try {
      const imported = await importAgentSkillsFromZipBatch({
        skills: selectable
          .filter((candidate) => selected[candidateKey(candidate.path)])
          .map((candidate) => ({
            onConflict: strategies[candidateKey(candidate.path)] ?? defaultStrategy,
            path: candidate.path,
          })),
        zipFileId: fileId,
      });

      if (!imported) throw new Error(t('agentSkillModal.batch.readError'));

      pendingFileIdRef.current = undefined;
      void fileService.removeUnreferencedFile(fileId).catch(() => {});
      setResult(imported);
      setStep('result');

      const written = imported.summary.created + imported.summary.updated;
      if (written > 0) {
        toast.success(t('agentSkillModal.batch.result.success', { count: written }));
      }
    } catch (importError: any) {
      if (mountedRef.current) {
        setError(importError?.message || String(importError));
      } else {
        discardPendingFile();
      }
    } finally {
      importingRef.current = false;
      setImporting(false);
    }
  };

  const renderStatusTag = (candidate: BatchImportCandidate) => {
    if (candidate.error) {
      return <Tag color="error">{t('agentSkillModal.batch.preview.invalid')}</Tag>;
    }
    if (candidate.conflict) {
      return <Tag color="warning">{t('agentSkillModal.batch.preview.conflict')}</Tag>;
    }
    if (candidate.duplicateOf !== undefined) {
      return <Tag color="warning">{t('agentSkillModal.batch.preview.duplicate')}</Tag>;
    }
    return <Tag color="success">{t('agentSkillModal.batch.preview.new')}</Tag>;
  };

  const renderUpload = () => (
    <Flexbox gap={16}>
      <Flexbox align="center" gap={16} padding={'16px 0'}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={Layers} size={28} />
          <Icon
            icon={ArrowLeftRight}
            size={16}
            style={{ color: 'var(--lobe-color-text-tertiary)' }}
          />
          <Icon icon={Sparkles} size={28} />
        </Flexbox>

        <Flexbox align="center" gap={4}>
          <Text as={'h4'} style={{ margin: 0 }}>
            {t('agentSkillModal.batch.upload.title')}
          </Text>
          <Text type={'secondary'}>{t('agentSkillModal.batch.upload.desc')}</Text>
        </Flexbox>
      </Flexbox>

      {error && (
        <Alert showIcon title={t('agentSkillModal.batch.importError', { error })} type="error" />
      )}

      <Upload
        dragger
        accept=".zip"
        disabled={loading || !canCreate}
        onFiles={([file]) => {
          if (file) void handleUpload(file);
        }}
      >
        <Flexbox align="center" gap={8} padding={24}>
          {loading ? (
            <>
              <Spin />
              <Text type={'secondary'}>{t('agentSkillModal.batch.upload.reading')}</Text>
            </>
          ) : (
            <>
              <Icon
                icon={InboxIcon}
                size={48}
                style={{ color: 'var(--lobe-color-text-quaternary)' }}
              />
              <Text type={'secondary'}>{t('agentSkillModal.batch.upload.dragText')}</Text>
            </>
          )}
        </Flexbox>
      </Upload>

      <Flexbox gap={8}>
        <Text strong>{t('agentSkillModal.batch.upload.requirements')}</Text>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <Text as={'span'} type={'secondary'}>
              {t('agentSkillModal.batch.upload.requirementFolders')}
            </Text>
          </li>
          <li>
            <Text as={'span'} type={'secondary'}>
              {t('agentSkillModal.batch.upload.requirementLimit', {
                count: MAX_BATCH_IMPORT_SKILLS,
              })}
            </Text>
          </li>
          <li>
            <Text as={'span'} type={'secondary'}>
              {t('agentSkillModal.batch.upload.requirementIgnore')}
            </Text>
          </li>
        </ul>
      </Flexbox>
    </Flexbox>
  );

  const renderPreview = () => {
    const conflictCount = candidates.filter((candidate) => candidate.conflict).length;
    const strategyCount = candidates.filter(
      (candidate) => candidate.conflict || candidate.duplicateOf !== undefined,
    ).length;

    return (
      <Flexbox gap={16}>
        <Flexbox gap={4}>
          <Text as={'h4'} style={{ margin: 0 }}>
            {t('agentSkillModal.batch.preview.title', { count: candidates.length })}
          </Text>
          <Text type={'secondary'}>
            {conflictCount > 0
              ? t('agentSkillModal.batch.preview.desc', { conflicts: conflictCount })
              : t('agentSkillModal.batch.preview.descNew')}
          </Text>
        </Flexbox>

        {error && (
          <Alert showIcon title={t('agentSkillModal.batch.importError', { error })} type="error" />
        )}

        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Flexbox horizontal align={'center'} gap={8}>
            <Checkbox
              checked={allSelected}
              disabled={importing || selectable.length === 0}
              indeterminate={indeterminate}
              onChange={handleToggleAll}
            />
            <Text style={{ fontSize: 12 }} type={'secondary'}>
              {t('agentSkillModal.batch.selected', { count: selectedCount })}
            </Text>
          </Flexbox>

          {strategyCount > 0 && (
            <Flexbox horizontal align={'center'} gap={8}>
              <Text style={{ fontSize: 12 }} type={'secondary'}>
                {t('agentSkillModal.batch.strategy.label')}
              </Text>
              <Segmented
                disabled={importing}
                size={'small'}
                value={defaultStrategy}
                options={[
                  { label: t('agentSkillModal.batch.strategy.skip'), value: 'skip' },
                  { label: t('agentSkillModal.batch.strategy.overwrite'), value: 'overwrite' },
                ]}
                onChange={(value) => handleDefaultStrategy(value as BatchImportConflictStrategy)}
              />
            </Flexbox>
          )}
        </Flexbox>

        <ScrollArea style={{ maxHeight: 360 }}>
          <Flexbox gap={8}>
            {candidates.map((candidate) => {
              const key = candidateKey(candidate.path);
              const isSelected = selected[key] ?? false;
              const needsStrategy = Boolean(candidate.conflict);

              return (
                <Block
                  horizontal
                  align={'center'}
                  gap={12}
                  key={key}
                  padding={12}
                  style={{ opacity: candidate.error ? 0.65 : 1 }}
                  variant={'outlined'}
                >
                  <Checkbox
                    aria-label={candidate.name}
                    checked={isSelected}
                    disabled={importing || Boolean(candidate.error)}
                    onChange={(checked) =>
                      setSelected((previous) => ({ ...previous, [key]: Boolean(checked) }))
                    }
                  />

                  <Flexbox flex={1} gap={4} style={{ minWidth: 0 }}>
                    <Flexbox horizontal align={'center'} gap={6} style={{ minWidth: 0 }}>
                      <Text ellipsis strong>
                        {candidate.name}
                      </Text>
                      {renderStatusTag(candidate)}
                    </Flexbox>

                    {candidate.description && (
                      <Text ellipsis fontSize={12} type={'secondary'}>
                        {candidate.description}
                      </Text>
                    )}

                    <Text ellipsis fontSize={12} type={'secondary'}>
                      {candidate.path || '/'}
                      {candidate.conflict
                        ? ` · ${t('agentSkillModal.batch.preview.conflictExisting', {
                            identifier: candidate.conflict.identifier,
                          })}`
                        : ''}
                      {candidate.duplicateOf !== undefined
                        ? ` · ${t('agentSkillModal.batch.preview.duplicateOf', {
                            path: candidate.duplicateOf || '/',
                          })}`
                        : ''}
                    </Text>

                    {candidate.error && (
                      <Text fontSize={12} type={'danger'}>
                        {candidate.error}
                      </Text>
                    )}
                  </Flexbox>

                  {!candidate.error && needsStrategy && (
                    <Segmented
                      disabled={importing || !isSelected}
                      size={'small'}
                      value={strategies[key] ?? defaultStrategy}
                      options={[
                        { label: t('agentSkillModal.batch.strategy.skip'), value: 'skip' },
                        {
                          label: t('agentSkillModal.batch.strategy.overwrite'),
                          value: 'overwrite',
                        },
                      ]}
                      onChange={(value) =>
                        setStrategies((previous) => ({
                          ...previous,
                          [key]: value as BatchImportConflictStrategy,
                        }))
                      }
                    />
                  )}
                </Block>
              );
            })}
          </Flexbox>
        </ScrollArea>

        <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} wrap={'wrap'}>
          <Button disabled={importing} size={'small'} type={'text'} onClick={handleBack}>
            {t('agentSkillModal.batch.back')}
          </Button>

          <Flexbox horizontal gap={8}>
            <Button disabled={importing} onClick={close}>
              {t('common:cancel')}
            </Button>
            <Button
              disabled={selectedCount === 0}
              loading={importing}
              type={'primary'}
              onClick={handleImport}
            >
              {importing
                ? t('agentSkillModal.batch.importing')
                : t('agentSkillModal.batch.import', { count: selectedCount })}
            </Button>
          </Flexbox>
        </Flexbox>
      </Flexbox>
    );
  };

  const renderResult = () => {
    if (!result) return null;

    return (
      <Flexbox gap={16}>
        <Flexbox gap={4}>
          <Text as={'h4'} style={{ margin: 0 }}>
            {t('agentSkillModal.batch.result.title')}
          </Text>
        </Flexbox>

        <Alert
          showIcon
          type={result.summary.failed > 0 ? 'warning' : 'success'}
          title={t('agentSkillModal.batch.result.summary', {
            created: result.summary.created,
            failed: result.summary.failed,
            skipped: result.summary.skipped,
            unchanged: result.summary.unchanged,
            updated: result.summary.updated,
          })}
        />

        <ScrollArea style={{ maxHeight: 360 }}>
          <Flexbox gap={8}>
            {result.results.map((item) => (
              <Flexbox horizontal align={'center'} gap={12} key={candidateKey(item.path)}>
                <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
                  <Text ellipsis strong>
                    {item.name}
                  </Text>
                  <Text ellipsis fontSize={12} type={'secondary'}>
                    {item.path || '/'}
                  </Text>
                  {item.error && (
                    <Text fontSize={12} type={'danger'}>
                      {item.error}
                    </Text>
                  )}
                </Flexbox>
                <Tag color={resultTagColors[item.status]}>
                  {t(`agentSkillModal.batch.result.${item.status}`)}
                </Tag>
              </Flexbox>
            ))}
          </Flexbox>
        </ScrollArea>

        <Flexbox horizontal justify={'flex-end'} style={{ bottom: 0, position: 'sticky' }}>
          <Button type={'primary'} onClick={close}>
            {t('agentSkillModal.batch.result.done')}
          </Button>
        </Flexbox>
      </Flexbox>
    );
  };

  return (
    <Flexbox gap={16}>
      {step === 'upload' && renderUpload()}
      {step === 'preview' && renderPreview()}
      {step === 'result' && renderResult()}
    </Flexbox>
  );
};

export const openBatchImportModal = (): ModalInstance =>
  createModal({
    content: <BatchImportContent />,
    footer: null,
    maskClosable: true,
    width: 'min(92vw, 640px)',
  });
