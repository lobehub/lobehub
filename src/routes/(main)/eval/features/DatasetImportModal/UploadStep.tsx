'use client';

import { type FileUploadState } from '@lobechat/types';
import { Center, Flexbox, Icon, Progress, Tag, Upload } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CloudUpload, ImportIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type DatasetPreset } from '../../config/datasetPresets';
import { ROLE_COLORS } from './const';

const styles = stylex.create({
  container: {
    overflow: 'hidden',
    padding: '16px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadiusLG,
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
  dragger: {
    borderRadius: cssVar.borderRadiusLG,
    transition: {
      'default': 'border-color 0.15s ease',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
  },
  draggerContent: { minHeight: '160px' },
  fieldsWrapper: { flexWrap: 'wrap' },
  formatDescription: {
    fontFamily: cssVar.fontFamilyCode,
    fontSize: cssVar.fontSizeSM,
    color: cssVar.colorTextTertiary,
  },
  hintText: { margin: '0', fontSize: cssVar.fontSizeSM, color: cssVar.colorTextTertiary },
  icon: { color: cssVar.colorPrimary },
  iconCenter: {
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    backgroundColor: cssVar.colorBgElevated,
    backgroundImage: 'none',
  },
  presetDescription: { fontSize: cssVar.fontSizeSM, color: cssVar.colorTextSecondary },
  presetName: { fontSize: cssVar.fontSizeLG, fontWeight: 600, color: cssVar.colorText },
  progressWrapper: { width: '100%', maxWidth: '320px' },
  roleLabel: { fontSize: cssVar.fontSizeSM },
  sectionLabel: { fontSize: cssVar.fontSizeSM, fontWeight: 500, color: cssVar.colorTextSecondary },
  uploadText: {
    margin: '0',
    fontSize: cssVar.fontSizeLG,
    fontWeight: 500,
    color: cssVar.colorText,
  },
});

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
        <Flexbox className={stylex.props(styles.container).className} gap={16}>
          {/* Identity */}
          <Flexbox horizontal align="center" gap={12}>
            <Center
              className={stylex.props(styles.iconCenter).className}
              flex="none"
              height={40}
              width={40}
            >
              <Icon icon={preset.icon} size={20} />
            </Center>
            <Flexbox flex={1} gap={2} style={{ minWidth: 0 }}>
              <div {...stylex.props(styles.presetName)}>{preset.name}</div>
              <div {...stylex.props(styles.presetDescription)}>{preset.description}</div>
            </Flexbox>
          </Flexbox>

          {preset.formatDescription && (
            <div {...stylex.props(styles.formatDescription)}>{preset.formatDescription}</div>
          )}

          {/* Field-role legend */}
          {fields.length > 0 && (
            <Flexbox gap={8}>
              <span {...stylex.props(styles.sectionLabel)}>{t('dataset.import.fieldMapping')}</span>
              <Flexbox horizontal className={stylex.props(styles.fieldsWrapper).className} gap={8}>
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
                        <div
                          className={stylex.props(styles.roleLabel).className}
                          style={{ color: color || undefined }}
                        >
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

      <Upload
        dragger
        accept=".csv,.xlsx,.xls,.json,.jsonl"
        className={stylex.props(styles.dragger).className}
        disabled={loading}
        maxCount={1}
        onFiles={([file]) => onFileSelect(file)}
      >
        {loading ? (
          <Center className={stylex.props(styles.draggerContent).className} gap={16}>
            <Icon
              className={stylex.props(styles.icon).className}
              icon={CloudUpload}
              size={{ size: 44, strokeWidth: 1.5 }}
            />
            <p {...stylex.props(styles.uploadText)}>{t('dataset.import.uploading')}</p>
            {uploadProgress && (
              <div {...stylex.props(styles.progressWrapper)}>
                <Progress percent={uploadProgress.progress} size="small" />
              </div>
            )}
          </Center>
        ) : (
          <Center className={stylex.props(styles.draggerContent).className} gap={12}>
            <Icon
              className={stylex.props(styles.icon).className}
              icon={ImportIcon}
              size={{ size: 44, strokeWidth: 1.5 }}
            />
            <p {...stylex.props(styles.uploadText)}>{t('dataset.import.upload.text')}</p>
            <p {...stylex.props(styles.hintText)}>{t('dataset.import.upload.hint')}</p>
          </Center>
        )}
      </Upload>
    </Flexbox>
  );
});

export default UploadStep;
