'use client';

import { createModal, Flexbox, Icon, Segmented, useModalContext } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { t } from 'i18next';
import { FileArchive, Link } from 'lucide-react';
import { Activity, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GithubImport } from './GithubImport';
import { SingleSkillImport } from './SingleSkillImport';
import { useGithubSkillImport } from './useGithubSkillImport';

type Source = 'github' | 'url' | 'file';

const SkillImportContent = () => {
  const { t } = useTranslation('setting');
  const { setCanDismissByClickOutside } = useModalContext();
  const [source, setSource] = useState<Source>('github');
  const github = useGithubSkillImport();
  const [submitting, setSubmitting] = useState(false);
  const busy = submitting || github.loading;

  useEffect(() => {
    setCanDismissByClickOutside(!busy);
  }, [busy, setCanDismissByClickOutside]);

  return (
    <Flexbox gap={24}>
      <div aria-label={t('agentSkillModal.source')} role="group">
        <Segmented<Source>
          block
          disabled={busy}
          value={source}
          options={[
            { icon: <Icon icon={GithubIcon} />, label: 'GitHub', value: 'github' },
            { icon: <Icon icon={Link} />, label: t('agentSkillModal.link'), value: 'url' },
            { icon: <Icon icon={FileArchive} />, label: t('agentSkillModal.file'), value: 'file' },
          ]}
          onChange={setSource}
        />
      </div>
      {source === 'github' && <GithubImport state={github} />}
      {(['url', 'file'] as const).map((method) => (
        <Activity key={method} mode={source === method ? 'visible' : 'hidden'}>
          <SingleSkillImport
            canCreate={github.canCreate}
            loading={submitting}
            source={method}
            onLoadingChange={setSubmitting}
          />
        </Activity>
      ))}
    </Flexbox>
  );
};

export const openSkillImportModal = () =>
  createModal({
    content: <SkillImportContent />,
    title: t('agentSkillModal.title', { ns: 'setting' }),
    width: 'min(560px, calc(100vw - 24px))',
  });
