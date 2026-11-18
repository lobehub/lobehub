'use client';

import {
  Button,
  CopyButton,
  createModal,
  Flexbox,
  type ModalInstance,
  toast,
  useModalContext,
} from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { t } from 'i18next';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAppOrigin } from '@/hooks/useAppOrigin';
import { useClientDataSWR } from '@/libs/swr';
import { oauthAppService } from '@/services/oauthApp';
import { useServerConfigStore } from '@/store/serverConfig';
import { serverConfigSelectors } from '@/store/serverConfig/selectors';

import { getRegistrationEndpoint, resolveIssuer } from '../../integrationEndpoints';

const styles = stylex.create({
  hint: { fontSize: '12px', lineHeight: 1.6, color: cssVar.colorTextSecondary },
  token: {
    paddingBlock: '4px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '4px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: cssVar.colorBorderSecondary,
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    overflowWrap: 'anywhere',
  },
});

interface TokenContentProps {
  endpoint: string;
  expiresAt: Date;
  needsApproval: boolean;
  token: string;
}

const TokenContent: FC<TokenContentProps> = ({ endpoint, expiresAt, needsApproval, token }) => {
  const { t } = useTranslation('auth');
  const { close } = useModalContext();

  return (
    <Flexbox gap={12}>
      <Flexbox horizontal align={'center'} className={stylex.props(styles.token).className} gap={8}>
        <Flexbox flex={1}>{token}</Flexbox>
        <CopyButton content={token} title={t('oauthApp.registration.copy')} />
      </Flexbox>
      <span {...stylex.props(styles.hint)}>
        {t('oauthApp.registration.onceWarning', {
          expiresAt: new Date(expiresAt).toLocaleString(),
        })}{' '}
        {t('oauthApp.registration.usage', { endpoint })}
        {needsApproval && <> {t('oauthApp.registration.approval')}</>}
      </span>
      <Flexbox horizontal justify={'flex-end'} style={{ marginTop: 4 }}>
        <Button type={'primary'} onClick={close}>
          {t('oauthApp.registration.dismiss')}
        </Button>
      </Flexbox>
    </Flexbox>
  );
};

/** Reveals the only copy of a fresh token; a stray click outside cannot close it. */
const showRegistrationTokenModal = (props: TokenContentProps): ModalInstance =>
  createModal({
    content: <TokenContent {...props} />,
    footer: null,
    maskClosable: false,
    title: t('oauthApp.registration.title', { ns: 'auth' }),
    width: 'min(90vw, 560px)',
  });

const OPEN_PLATFORM_KEY = 'oauth-open-platform';

/**
 * Mints a single-use token a partner uses to register its own app through
 * RFC 7591. Hidden unless the server enabled dynamic registration.
 */
const RegistrationTokenButton = ({ size }: { size?: 'small' }) => {
  const { t } = useTranslation('auth');
  const [loading, setLoading] = useState(false);
  const { data: openPlatform } = useClientDataSWR(OPEN_PLATFORM_KEY, () =>
    oauthAppService.getOpenPlatform(),
  );
  const configuredIssuer = useServerConfigStore(serverConfigSelectors.oidcIssuer);
  const appOrigin = useAppOrigin();

  if (!openPlatform?.dynamicRegistration) return null;

  const handleClick = async () => {
    setLoading(true);
    try {
      const { expiresAt, token } = await oauthAppService.createRegistrationToken();
      showRegistrationTokenModal({
        endpoint: getRegistrationEndpoint(resolveIssuer(configuredIssuer, appOrigin)),
        expiresAt,
        needsApproval: openPlatform.registrationApproval,
        token,
      });
    } catch {
      toast.error(t('oauthApp.registration.failed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button loading={loading} size={size} onClick={handleClick}>
      {t('oauthApp.registration.action')}
    </Button>
  );
};

export default RegistrationTokenButton;
