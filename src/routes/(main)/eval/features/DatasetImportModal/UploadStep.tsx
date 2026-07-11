'use client';

import { type FileUploadState } from '@lobechat/types';
import { Center, Flexbox, Icon, Tag } from '@lobehub/ui';
import { Progress, Upload } from 'antd';
import { createStaticStyles } from 'antd-style';
import { CloudUpload, ImportIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DatasetPreset } from '../../config/datasetPresets';
import { ROLE_COLORS } from './const';

const { Dragger } = Upload;

const styles = createStaticStyles(({ css, cssVar }) => ({
  // Preset summary panel — a single tonal card describing the chosen format.
  container: css`
    overflow: hidden;

    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadiusLG};

    background: ${cssVar.colorFillQuaternary};
  `,
  // Bold dropzone — the single primary action of this step.
  dragger: css`
    .ant-upload-drag {
      border-radius: ${cssVar.borderRadiusLG};
      transition: border-color 0.15s ease;

      @media (prefers-reduced-motion: reduce) {
        transition: none;
      }
    }
  `,
  draggerContent: css`
    min-height: 160px;
  `,
  fieldsWrapper: css`
    flex-wrap: wrap;
  `,
  formatDescription: css`
    font-family: ${cssVar.fontFamilyCode};
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  hintText: css`
    margin: 0;
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextTertiary};
  `,
  icon: css`
    color: ${cssVar.colorPrimary};
  `,
  iconCenter: css`
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: ${cssVar.borderRadius};
    background: ${cssVar.colorBgElevated};
  `,
  presetDescription: css`
    font-size: ${cssVar.fontSizeSM};
    color: ${cssVar.colorTextSecondary};
  `,
  presetName: css`
    font-size: ${cssVar.fontSizeLG};
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
  progressWrapper: css`
    width: 100%;
    max-width: 320px;
  `,
  roleLabel: css`
    font-size: ${cssVar.fontSizeSM};
  `,
  // Section label above the field-role legend.
  sectionLabel: css`
    font-size: ${cssVar.fontSizeSM};
    font-weight: 500;
    color: ${cssVar.colorTextSecondary};
  `,
  uploadText: css`
    margin: 0;
    font-size: ${cssVar.fontSizeLG};
    font-weight: 500;
    color: ${cssVar.colorText};
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
        <Flexbox className={styles.container} gap={16}>
          {/* Identity */}
          <Flexbox horizontal align="center" gap={12}>
            <Center className={styles.iconCenter} flex="none" height={40} width={40}>
              <Icon icon={preset.icon} size={20} />
            </Center>
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <div className={styles.presetName}>{preset.name}</div>
              <div className={styles.presetDescription}>{preset.description}</div>
            </Flexbox>
          </Flexbox>

          {preset.formatDescription && (
            <div className={styles.formatDescription}>{preset.formatDescription}</div>
          )}

          {/* Field-role legend */}
          {fields.length > 0 && (
            <Flexbox gap={8}>
              <span className={styles.sectionLabel}>{t('dataset.import.fieldMapping')}</span>
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
          )}
        </Flexbox>
      )}

      <Dragger
        accept=".csv,.xlsx,.xls,.json,.jsonl"
        className={styles.dragger}
        disabled={loading}
        maxCount={1}
        showUploadList={false}
        beforeUpload={(file) => {
          onFileSelect(file);
          return false;
        }}
      >
        {loading ? (
          <Center className={styles.draggerContent} gap={16}>
            <Icon
              className={styles.icon}
              icon={CloudUpload}
              size={{ size: 44, strokeWidth: 1.5 }}
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
            <Icon className={styles.icon} icon={ImportIcon} size={{ size: 44, strokeWidth: 1.5 }} />
            <p className={styles.uploadText}>{t('dataset.import.upload.text')}</p>
            <p className={styles.hintText}>{t('dataset.import.upload.hint')}</p>
          </Center>
        )}
      </Dragger>
    </Flexbox>
  );
});

export default UploadStep;
