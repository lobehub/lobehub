'use client';

import { Github } from '@lobehub/icons';
import { Button, Flexbox, Icon, Switch, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { PlusIcon, SettingsIcon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import OptionRow from './OptionRow';

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
  keep: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBlock: '8px',
    paddingInline: '8px',
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
  description?: string | null;
  id: string;
  name: string;
}

interface SandboxRepositoryMenuProps {
  /** The plan includes a drive, so a repository's clone can be kept on it. */
  canKeep: boolean;
  environments: SandboxRepositoryOption[];
  failed: boolean;
  /** Whether the current pick is a clone kept on the drive. */
  kept: boolean;
  loaded: boolean;
  onAdd: () => void;
  /** Closes the whole work-location menu; a final pick leaves it. */
  onClose: () => void;
  onManage: () => void;
  /** Resolves to whether the pick was saved. */
  onPick: (environment: SandboxRepositoryOption, keep: boolean) => Promise<boolean>;
  onRetry: () => void;
  selectedId?: string;
}

/**
 * The second level of the work-location menu: the repositories a conversation
 * can work on, and the way to add one without leaving the composer.
 */
const SandboxRepositoryMenu = memo<SandboxRepositoryMenuProps>(
  ({
    canKeep,
    environments,
    failed,
    kept,
    loaded,
    onAdd,
    onClose,
    onManage,
    onPick,
    onRetry,
    selectedId,
  }) => {
    const { t } = useTranslation('chat');
    const [keep, setKeep] = useState(kept);
    const selected = environments.find((environment) => environment.id === selectedId);

    const toggleKeep = async (next: boolean) => {
      setKeep(next);
      // With a repository picked the switch moves it now, and the menu stays:
      // the person is still looking at the choice they just changed.
      if (selected && !(await onPick(selected, next))) setKeep(!next);
    };

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
              icon={<Github size={16} />}
              key={environment.id}
              label={environment.name}
              onClick={() => {
                onClose();
                void onPick(environment, keep);
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

        {canKeep && (
          <div {...stylex.props(styles.keep)}>
            <Flexbox gap={1}>
              <Text fontSize={13} weight={500}>
                {t('sandboxEnvironment.keep')}
              </Text>
              <Text fontSize={11} type={'secondary'}>
                {t('sandboxEnvironment.keepDesc')}
              </Text>
            </Flexbox>
            <Switch checked={keep} size={'small'} onChange={(next) => void toggleKeep(next)} />
          </div>
        )}
      </Flexbox>
    );
  },
);

SandboxRepositoryMenu.displayName = 'SandboxRepositoryMenu';

export default SandboxRepositoryMenu;
