'use client';

import { BRANDING_EMAIL } from '@lobechat/business-const';
import { Button, cssVar, Flexbox, Icon, Text } from '@lobehub/ui';
import { Form } from '@lobehub/ui/form';
import { CircleCheck, PackageOpen } from 'lucide-react';
import { memo } from 'react';
import { Trans, useTranslation } from 'react-i18next';

import { useExportDiagnostics } from '@/features/Electron/system/useExportDiagnostics';

/**
 * Desktop: lets a reporter export the diagnostics zip from the dialog they are
 * already in. The zip stays on their computer (it carries file paths and URLs);
 * the hint says where to send it.
 */
const DiagnosticsField = memo(() => {
  const { t } = useTranslation('common');
  const { exportDiagnostics, exporting, result } = useExportDiagnostics();

  return (
    <Form.Field label={t('feedback.fields.diagnostics.label')} style={{ marginBottom: 0 }}>
      <Flexbox gap={8}>
        <Flexbox horizontal align={'center'} gap={8} wrap={'wrap'}>
          <Button
            icon={<Icon icon={PackageOpen} />}
            loading={exporting}
            onClick={exportDiagnostics}
          >
            {t('diagnostics.export.action')}
          </Button>
          {result && (
            <Flexbox horizontal align={'center'} gap={4} style={{ minWidth: 0 }}>
              <Icon color={cssVar.colorSuccess} icon={CircleCheck} size={14} />
              <Text ellipsis fontSize={12} type={'secondary'}>
                {t('feedback.fields.diagnostics.exported', { fileName: result.fileName })}
              </Text>
            </Flexbox>
          )}
        </Flexbox>
        <Text fontSize={12} type={'secondary'}>
          <Trans
            i18nKey="feedback.fields.diagnostics.hint"
            ns="common"
            values={{ email: BRANDING_EMAIL.business }}
            components={{
              email: (
                <a
                  href={`mailto:${BRANDING_EMAIL.business}`}
                  rel="noopener noreferrer"
                  style={{ color: 'inherit', textDecoration: 'underline' }}
                  target="_blank"
                />
              ),
            }}
          />
        </Text>
      </Flexbox>
    </Form.Field>
  );
});

DiagnosticsField.displayName = 'DiagnosticsField';

export default DiagnosticsField;
