'use client';

import { Flexbox } from '@lobehub/ui';
import { Button } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { INBOX_SESSION_ID } from '@/const/session';
import { useIsDark } from '@/hooks/useIsDark';
import { useAgentStore } from '@/store/agent';
import { builtinAgentSelectors } from '@/store/agent/selectors';
import type { DiscoverSkillItem } from '@/types/discover';

const styles = createStaticStyles(({ css }) => ({
  button: css`
    padding-inline: 24px;
    border-radius: 24px;
  `,
  container: css`
    width: 100%;
    max-width: 720px;
    margin-block: 0;
    margin-inline: auto;
    padding: 32px;
    border-radius: 16px;
  `,
  container_dark: css`
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
  `,
  container_light: css`
    background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
  `,
  description: css`
    margin: 0;
    font-size: 14px;
    line-height: 1.5;
    color: rgb(255 255 255 / 65%);
  `,
  title: css`
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: rgb(255 255 255 / 95%);
  `,
}));

interface InstallCTAProps {
  collectionTitle: string;
  skills: DiscoverSkillItem[];
}

const InstallCTA = memo<InstallCTAProps>(({ collectionTitle, skills }) => {
  const { t } = useTranslation('discover');
  const isDark = useIsDark();
  const navigate = useNavigate();
  const inboxAgentId = useAgentStore(builtinAgentSelectors.inboxAgentId);

  const handleInstallAll = useCallback(() => {
    if (!skills || skills.length === 0) return;

    // Build the skill identifiers list
    const skillIdentifiers = skills.map((s) => `- ${s.identifier}`).join('\n');

    // Build the installation message
    const message = `Read https://lobehub.com/skills/skill.md and follow the instructions to setup LobeHub Skills Marketplace.
Then install every skill in the "${collectionTitle}" collection:
${skillIdentifiers}

After installation, read each installed SKILL.md and complete any required setup.`;

    // Navigate to inbox with the message
    const agentId = inboxAgentId || INBOX_SESSION_ID;
    const encodedMessage = encodeURIComponent(message);
    navigate(`/agent/${agentId}?message=${encodedMessage}`);
  }, [skills, collectionTitle, inboxAgentId, navigate]);

  const skillCount = skills?.length || 0;

  return (
    <Flexbox
      align={'center'}
      className={cx(styles.container, isDark ? styles.container_dark : styles.container_light)}
      gap={16}
    >
      <h3 className={styles.title}>{t('skills.collection.installTitle')}</h3>
      <p className={styles.description}>
        {t('skills.collection.installDesc', { count: skillCount })}
      </p>
      <Button
        className={styles.button}
        size="large"
        style={{ background: '#fff', color: '#000' }}
        onClick={handleInstallAll}
      >
        {t('skills.collection.installAll')}
      </Button>
    </Flexbox>
  );
});

export default InstallCTA;
