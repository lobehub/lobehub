'use client';

import { Center, Empty } from '@lobehub/ui';
import { ContainerIcon } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Opens whatever explains, to a user whose plan has no persistent sandbox, how
 * to get one. Called from the working-directory menu of a cloud-sandbox run,
 * which offers persistence as a tagged row for such a plan; the row calls this.
 *
 * A no-op in the open-source build: persistence there is a deployment decision,
 * not a purchase, so there is nothing to sell. Downstream builds override this
 * module through their own `@/business/...` mapping.
 */
export const openSandboxWorkspaceUpsell = (): void => {};

/**
 * What the environments page shows in place of its content when the account
 * has no persistent workspace to build environments in. Same reasoning as
 * above: here it says the feature is not available on this deployment, and a
 * downstream build replaces it with its own way of getting one.
 */
export const SandboxWorkspaceUpgradeGuide = memo(() => {
  const { t } = useTranslation('setting');

  return (
    <Center style={{ minHeight: 320 }} width={'100%'}>
      <Empty
        description={t('environments.unavailable.desc')}
        descriptionProps={{ fontSize: 13 }}
        icon={ContainerIcon}
        style={{ maxWidth: 400 }}
        title={t('environments.unavailable.title')}
      />
    </Center>
  );
});

SandboxWorkspaceUpgradeGuide.displayName = 'SandboxWorkspaceUpgradeGuide';
