'use client';

import { Flexbox } from '@lobehub/ui';
import { Switch } from '@lobehub/ui/base-ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Section, SettingRow } from './SectionLayout';
import type { AgentShareConfigPatch, AgentShareConfigState } from './useAgentShare';

interface PermissionsSectionProps {
  onChange: (patch: AgentShareConfigPatch) => void;
  shareConfig: AgentShareConfigState;
}

/** What a visitor's run may read, and what the visitor is allowed to see back. */
const PermissionsSection = memo<PermissionsSectionProps>(({ onChange, shareConfig }) => {
  const { t } = useTranslation('agent');

  return (
    <Section
      desc={t('share.settings.permissions.desc')}
      title={t('share.settings.permissions.title')}
    >
      <Flexbox gap={12}>
        <SettingRow
          desc={t('share.settings.permissions.allowReadMemoryHint')}
          label={t('share.settings.permissions.allowReadMemory')}
        >
          <Switch
            checked={shareConfig.allowReadMemory ?? false}
            onChange={(checked) => onChange({ allowReadMemory: checked })}
          />
        </SettingRow>
        {/* `allowCreatorViewSessions` is persisted (zod schema + DB default false)
            but no read path honors it yet — creator reads unconditionally
            exclude visitor rows (see packages/database/src/models/topic.ts).
            Hidden here until that read path exists, so the switch is not
            surfaced as a working control. */}
        <SettingRow
          desc={t('share.settings.permissions.showModelInfoHint')}
          label={t('share.settings.permissions.showModelInfo')}
        >
          <Switch
            checked={shareConfig.showModelInfo ?? false}
            onChange={(checked) => onChange({ showModelInfo: checked })}
          />
        </SettingRow>
        <SettingRow
          desc={t('share.settings.permissions.showErrorDetailsHint')}
          label={t('share.settings.permissions.showErrorDetails')}
        >
          <Switch
            checked={shareConfig.showErrorDetails ?? false}
            onChange={(checked) => onChange({ showErrorDetails: checked })}
          />
        </SettingRow>
      </Flexbox>
    </Section>
  );
});

PermissionsSection.displayName = 'AgentSharePermissionsSection';

export default PermissionsSection;
