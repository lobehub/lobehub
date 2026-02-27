'use client';

import { type FileUploadState } from '@lobechat/types';
import { Center, Flexbox, Icon, Tag } from '@lobehub/ui';
import { Divider, Progress, Upload } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CloudUpload, ImportIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DatasetPreset } from '../../config/datasetPresets';
import { ROLE_COLORS } from './const';

const { Dragger } = Upload;

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    overflow: hidden;
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadiusLG};
  `,
  divider: css`
    margin: 0;
  `,
  draggerContent: css`
    min-height: 140px;
  `,
  fieldsWrapper: css`
    flex-wrap: wrap;
  `,
  formatDescription: css`
    color: ${cssVar.colorTextDescription};
    font-size: 12px;
  `,
  hintText: css`
    margin: 0;
    color: ${cssVar.colorTextTertiary};
    font-size: 12px;
  `,
  icon: css`
    color: ${cssVar.colorPrimary};
  `,
  iconCenter: css`
    background: ${cssVar.colorBgElevated};
    border: 1px solid ${cssVar.colorFillTertiary};
    border-radius: ${cssVar.borderRadius};
  `,
  presetDescription: css`
    color: ${cssVar.colorTextSecondary};
    font-size: 12px;
  `,
  presetName: css`
    font-size: 14px;
    font-weight: 500;
  `,
  progressWrapper: css`
    width: 100%;
    max-width: 320px;
  `,
  roleLabel: css`
    font-size: 10px;
  `,
  uploadText: css`
    margin: 0;
    color: ${cssVar.colorText};
    font-size: 14px;
    font-weight: 500;
  `,
}));

interface UploadStepProps {
  loading: boolean;
  onFileSelect: (file: File) => void;
  preset?: DatasetPreset;
  uploadProgress?: FileUploadState;
}

type FieldRole = 'category' | 'choices' | 'expected' | 'input' | 'sortOrder';

const FIELD_ROLE_KEYS: FieldRole[] = ['input', 'expected', 'choices', 'category', 'sortOrder'];

const getFieldRole = (
  fieldName: string,
  fieldInference: DatasetPreset['fieldInference'],
): FieldRole | undefined => {
  const lower = fieldName.toLowerCase();
  for (const role of FIELD_ROLE_KEYS) {
    const candidates = fieldInference[role];
    if (candidates?.some((f) => f.toLowerCase() === lower)) {
      return role;
    }
  }
};

const UploadStep = memo<UploadStepProps>(({ onFileSelect, loading, preset, uploadProgress }) => {
  const { t } = useTranslation('eval');

  const fields = useMemo(() => {
    if (!preset) return [];

    const required = preset.requiredFields.map((name) => ({
      name,
      required: true,
      role: getFieldRole(name, preset.fieldInference),
    }));

    const optional = preset.optionalFields.map((name) => ({
      name,
      required: false,
      role: getFieldRole(name, preset.fieldInference),
    }));

    return [...required, ...optional];
  }, [preset]);

  return (
    <Flexbox gap={16}>
      {preset && (
        <div className={styles.container}>
          {/* Header */}
          <Flexbox horizontal align="center" gap={8} paddingBlock={12} paddingInline={16}>
            <Center className={styles.iconCenter} flex="none" height={36} width={36}>
              <Icon icon={preset.icon} />
            </Center>
            <Flexbox flex={1}>
              <div className={styles.presetName}>{preset.name}</div>
              <div className={styles.presetDescription}>{preset.description}</div>
            </Flexbox>
          </Flexbox>

          <Divider className={styles.divider} />

          {/* Body */}
          <Flexbox gap={12} paddingBlock={12} paddingInline={16}>
            {preset.formatDescription && (
              <div className={styles.formatDescription}>{preset.formatDescription}</div>
            )}

            {/* Fields */}
            <Flexbox horizontal className={styles.fieldsWrapper} gap={8}>
              {fields.map((field) => {
                const color = field.role ? ROLE_COLORS[field.role] : undefined;
                return (
                  <Flexbox align="center" gap={2} key={field.name}>
                    <Tag
                      style={
                        color
                          ? {
                              background: `color-mix(in srgb, ${color} 15%, transparent)`,
                              borderColor: 'transparent',
                              color,
                            }
                          : undefined
                      }
                    >
                      {field.name}
                      {field.required && ' *'}
                    </Tag>
                    {field.role && (
                      <div className={styles.roleLabel} style={{ color: color || undefined }}>
                        {field.role}
                      </div>
                    )}
                  </Flexbox>
                );
              })}
            </Flexbox>
          </Flexbox>
        </div>
      )}

      <Dragger
        accept=".csv,.xlsx,.xls,.json,.jsonl"
        disabled={loading}
        maxCount={1}
        showUploadList={false}
        beforeUpload={(file) => {
          onFileSelect(file);
          return false;
        }}
      >
        {loading ? (
          <Center className={styles.draggerContent} gap={12}>
            <Icon
              className={styles.icon}
              icon={CloudUpload}
              size={{ size: 40, strokeWidth: 1.5 }}
            />
            <p className={styles.uploadText}>{t('dataset.import.uploading')}</p>
            {uploadProgress && (
              <div className={styles.progressWrapper}>
                <Progress percent={uploadProgress.progress} size="small" />
              </div>
            )}
          </Center>
        ) : (
          <Center className={styles.draggerContent} gap={12}>
            <Icon className={styles.icon} icon={ImportIcon} size={{ size: 40, strokeWidth: 1.5 }} />
            <p className={styles.uploadText}>{t('dataset.import.upload.text')}</p>
            <p className={styles.hintText}>{t('dataset.import.upload.hint')}</p>
          </Center>
        )}
      </Dragger>
    </Flexbox>
  );
});

export default UploadStep;
