'use client';

import type { EnvironmentConfiguration } from '@lobechat/types';
import { Button, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { CircleOffIcon, ContainerIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import RepositoryAvatar from '@/components/RepositoryAvatar';

import OptionRow from './OptionRow';
import { repositoriesLabel, repositorySlug } from './sandboxEnvironmentOptions';
import SubmenuHeader from './SubmenuHeader';

const styles = stylex.create({
  hint: {
    paddingInline: '8px',
    fontSize: '12px',
    color: cssVar.colorTextDescription,
  },
  list: {
    maxHeight: '280px',
    overflowY: 'auto',
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
  /**
   * A first row for working without a repository. Offered where this menu is
   * the whole choice — the temporary sandbox, whose folder is always a fresh
   * empty one — rather than one level under a list of places.
   */
  none?: { active: boolean; onPick: () => void };
  /** Adds an environment and picks it. Absent where there is no other one to add — a project's. */
  onAdd?: () => void;
  /** Closes the whole work-location menu; a final pick leaves it. */
  onClose: () => void;
  onManage: () => void;
  onPick: (environment: SandboxRepositoryOption) => Promise<void>;
  onRetry: () => void;
  selectedId?: string;
}

/**
 * The repositories a conversation can work on, and the way to add one without
 * leaving the composer: the whole menu on the temporary sandbox, one level
 * under the drive's folders on the persistent one.
 */
const SandboxRepositoryMenu = memo<SandboxRepositoryMenuProps>(
  ({
    environments,
    failed,
    loaded,
    none,
    onAdd,
    onClose,
    onManage,
    onPick,
    onRetry,
    selectedId,
  }) => {
    const { t } = useTranslation('chat');
    return (
      <Flexbox gap={2} style={{ maxWidth: 360, minWidth: 280 }}>
        <SubmenuHeader
          title={t('sandboxEnvironment.title')}
          action={{
            icon: SettingsIcon,
            label: t('sandboxDrive.manageEnvironments'),
            onClick: onManage,
          }}
        />
        <Text className={stylex.props(styles.hint).className}>{t('sandboxEnvironment.hint')}</Text>

        <div {...stylex.props(styles.list)}>
          {none && (
            <OptionRow
              compact
              active={none.active}
              icon={<Icon icon={CircleOffIcon} size={16} />}
              label={t('sandboxEnvironment.none')}
              onClick={() => {
                onClose();
                none.onPick();
              }}
            />
          )}
          {environments.map((environment) => (
            <OptionRow
              compact
              active={environment.id === selectedId}
              desc={environment.description || undefined}
              // An environment, which checks out any number of repositories or
              // none: its repositories as `owner/name +N`, said plainly when
              // it has none.
              hint={repositoriesLabel(environment) ?? t('sandboxEnvironment.noRepository')}
              key={environment.id}
              label={environment.name}
              icon={
                repositorySlug(environment) ? (
                  <RepositoryAvatar size={16} url={repositorySlug(environment)} />
                ) : (
                  <Icon icon={ContainerIcon} size={16} />
                )
              }
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

        {onAdd && (
          <OptionRow
            compact
            icon={<Icon icon={PlusIcon} size={16} />}
            label={t('sandboxEnvironment.add')}
            onClick={onAdd}
          />
        )}
      </Flexbox>
    );
  },
);

SandboxRepositoryMenu.displayName = 'SandboxRepositoryMenu';

export default SandboxRepositoryMenu;
