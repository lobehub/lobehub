'use client';

import type { EnvironmentConfiguration } from '@lobechat/types';
import { Github } from '@lobehub/icons';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon, SettingsIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import OptionRow from './OptionRow';
import { repositorySlug } from './sandboxEnvironmentOptions';

const styles = stylex.create({
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '4px',
    paddingInline: '8px',
  },
  headerTitle: {
    fontSize: '12px',
    fontWeight: 500,
    color: cssVar.colorTextSecondary,
  },
  hint: {
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  list: {
    maxHeight: '280px',
    overflowY: 'auto',
  },
  manageButton: {
    cursor: 'pointer',
    display: 'flex',
    gap: '4px',
    alignItems: 'center',
    padding: '0',
    borderStyle: 'none',
    fontSize: '11px',
    color: { 'default': cssVar.colorTextQuaternary, ':hover': cssVar.colorPrimary },
    backgroundColor: 'transparent',
    backgroundImage: 'none',
    transition: 'color 0.2s',
  },
});

export interface SandboxRepositoryOption {
  configuration?: Pick<EnvironmentConfiguration, 'sources'> | null;
  description?: string | null;
  id: string;
  name: string;
}

interface SandboxRepositoryMenuProps {
  environments: SandboxRepositoryOption[];
  failed: boolean;
  loaded: boolean;
  onAdd: () => void;
  /** Closes the whole work-location menu; a final pick leaves it. */
  onClose: () => void;
  onManage: () => void;
  onPick: (environment: SandboxRepositoryOption) => Promise<void>;
  onRetry: () => void;
  selectedId?: string;
}

/**
 * The second level of the work-location menu: the repositories a conversation
 * can work on, and the way to add one without leaving the composer.
 */
const SandboxRepositoryMenu = memo<SandboxRepositoryMenuProps>(
  ({ environments, failed, loaded, onAdd, onClose, onManage, onPick, onRetry, selectedId }) => {
    const { t } = useTranslation('chat');
    return (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
        <div {...stylex.props(styles.header)}>
          <span {...stylex.props(styles.headerTitle)}>{t('sandboxEnvironment.title')}</span>
          <button {...stylex.props(styles.manageButton)} type={'button'} onClick={onManage}>
            <Icon icon={SettingsIcon} size={11} />
            <span>{t('sandboxDrive.manageEnvironments')}</span>
          </button>
        </div>
        <Text className={stylex.props(styles.hint).className}>{t('sandboxEnvironment.hint')}</Text>

        <div {...stylex.props(styles.list)}>
          {environments.map((environment) => (
            <OptionRow
              compact
              active={environment.id === selectedId}
              desc={environment.description || undefined}
              hint={repositorySlug(environment)}
              icon={<Github size={16} />}
              key={environment.id}
              label={environment.name}
              onClick={() => {
                onClose();
                void onPick(environment);
              }}
            />
          ))}
        </div>

        {loaded && environments.length === 0 && (
          <Text className={stylex.props(styles.hint).className}>
            {t('sandboxEnvironment.empty')}
          </Text>
        )}
        {!loaded && failed && (
          <Flexbox horizontal align={'center'} gap={8} justify={'space-between'} paddingInline={8}>
            <Text className={stylex.props(styles.hint).className} type={'danger'}>
              {t('sandboxEnvironment.loadFailed')}
            </Text>
            <Button onClick={onRetry}>{t('sandboxEnvironment.retry')}</Button>
          </Flexbox>
        )}

        <OptionRow
          compact
          icon={<Icon icon={PlusIcon} size={16} />}
          label={t('sandboxEnvironment.add')}
          onClick={onAdd}
        />
      </Flexbox>
    );
  },
);

SandboxRepositoryMenu.displayName = 'SandboxRepositoryMenu';

export default SandboxRepositoryMenu;
