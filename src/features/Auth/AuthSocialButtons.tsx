'use client';

import { Flexbox, Icon, Text } from '@lobehub/ui';
import { Button } from '@lobehub/ui/base-ui';
import { Divider } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Smartphone } from 'lucide-react';
import { type CSSProperties, memo } from 'react';
import { useTranslation } from 'react-i18next';

import AuthIcons from '@/components/AuthIcons';

const styles = createStaticStyles(({ css, cssVar }) => ({
  divider: css`
    margin-block: 4px !important;

    .ant-divider-inner-text {
      padding-inline: 12px;
      font-size: 13px;
      color: ${cssVar.colorTextSecondary};
    }
  `,
  row: css`
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    align-items: stretch;
    justify-content: center;

    width: 100%;
  `,
  socialButton: css`
    flex: 1 1 0;

    min-inline-size: 72px;
    max-inline-size: 120px;
    height: 48px !important;
    padding-inline: 0 !important;
    border-radius: 10px !important;
  `,
}));

const PROVIDER_ICON_STYLE: CSSProperties = {
  margin: 0,
};

const getProviderName = (provider: string) =>
  provider.toLowerCase().replaceAll(/(^|[_-])([a-z])/g, (_, __, c) => c.toUpperCase());

export interface AuthSocialButtonsProps {
  oAuthSSOProviders: string[];
  onPhoneClick?: () => void;
  onSocialSignIn: (provider: string) => void;
  phoneDisabled?: boolean;
  phoneDisabledHintKey?: 'betterAuth.signup.phoneDisabledHint';
  phoneLabelKey?: 'betterAuth.signin.continueWithPhone' | 'betterAuth.signup.phoneLink';
  showDivider?: boolean;
  socialLoading: string | null;
}

export const AuthSocialButtons = memo<AuthSocialButtonsProps>(
  ({
    phoneDisabled = false,
    phoneDisabledHintKey,
    oAuthSSOProviders,
    onPhoneClick,
    onSocialSignIn,
    phoneLabelKey = 'betterAuth.signin.continueWithPhone',
    showDivider = true,
    socialLoading,
  }) => {
    const { t } = useTranslation('auth');

    if (oAuthSSOProviders.length === 0 && !onPhoneClick) return null;

    const getProviderLabel = (provider: string) => {
      const normalized = getProviderName(provider);
      const normalizedKey = normalized.replaceAll(/[^\da-z]/gi, '');
      const key = `betterAuth.signin.continueWith${normalizedKey}`;
      return t(key, { defaultValue: `Continue with ${normalized}` });
    };

    const phoneLabel = t(phoneLabelKey);
    const phoneDisabledHint = phoneDisabledHintKey ? t(phoneDisabledHintKey) : null;

    return (
      <Flexbox gap={12}>
        <div className={styles.row}>
          {oAuthSSOProviders.map((provider) => {
            const label = getProviderLabel(provider);

            return (
              <Button
                aria-label={label}
                className={styles.socialButton}
                icon={<Icon icon={AuthIcons(provider, 22)} style={PROVIDER_ICON_STYLE} />}
                key={provider}
                loading={socialLoading === provider}
                size="large"
                title={label}
                type="fill"
                onClick={() => onSocialSignIn(provider)}
              />
            );
          })}
          {onPhoneClick ? (
            <Button
              aria-label={phoneLabel}
              className={styles.socialButton}
              disabled={phoneDisabled}
              icon={<Icon icon={Smartphone} size={22} style={PROVIDER_ICON_STYLE} />}
              size="large"
              title={phoneDisabledHint || phoneLabel}
              type="fill"
              onClick={onPhoneClick}
            />
          ) : null}
        </div>
        {phoneDisabledHint ? (
          <Text align="center" fontSize={12} type="secondary">
            {phoneDisabledHint}
          </Text>
        ) : null}
        {showDivider && (
          <Divider plain className={styles.divider}>
            <Text fontSize={13} type="secondary">
              {t('betterAuth.signin.orContinueWith')}
            </Text>
          </Divider>
        )}
      </Flexbox>
    );
  },
);

AuthSocialButtons.displayName = 'AuthSocialButtons';

export default AuthSocialButtons;
