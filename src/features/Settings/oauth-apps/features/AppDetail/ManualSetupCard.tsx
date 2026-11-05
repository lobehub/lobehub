'use client';

import { CopyButton, Flexbox, Icon, Text } from '@lobehub/ui';
import { cssVar } from '@lobehub/ui/stylex/cssVar.stylex';
import * as stylex from '@stylexjs/stylex';
import { ChevronDownIcon } from 'lucide-react';
import { type FC, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type IntegrationEndpointKey } from '../../integrationEndpoints';
import { useIntegrationEndpoints } from './IntegrationCard';
import SectionCard from './SectionCard';

const styles = stylex.create({
  chevron: { color: cssVar.colorTextTertiary, transition: 'transform 0.2s ease' },
  chevronOpen: { transform: 'rotate(180deg)' },
  header: { cursor: 'pointer', userSelect: 'none' },
  label: { fontSize: '12px', color: cssVar.colorTextSecondary },
  value: {
    paddingBlock: '2px',
    paddingInlineStart: '12px',
    paddingInlineEnd: '2px',
    borderRadius: cssVar.borderRadius,
    fontFamily: cssVar.fontFamilyCode,
    fontSize: '13px',
    overflowWrap: 'anywhere',
    backgroundColor: cssVar.colorFillQuaternary,
    backgroundImage: 'none',
  },
});

const LABEL_KEYS = {
  authorization: 'oauthApp.integration.authorization',
  deviceAuthorization: 'oauthApp.integration.deviceAuthorization',
  discovery: 'oauthApp.integration.discovery',
  issuer: 'oauthApp.integration.issuer',
  token: 'oauthApp.integration.token',
} as const satisfies Record<IntegrationEndpointKey, string>;

interface ManualSetupCardProps {
  applicationType?: string | null;
}

/**
 * The raw issuer and endpoint URLs, for configuring an OAuth / OIDC client by
 * hand. Reference material most developers never need (the one-prompt
 * integration and discovery cover them), so it sits last on the Credentials
 * tab and starts folded.
 */
const ManualSetupCard: FC<ManualSetupCardProps> = ({ applicationType }) => {
  const { t } = useTranslation('auth');
  const endpoints = useIntegrationEndpoints(applicationType);
  const [open, setOpen] = useState(false);
  const toggle = () => setOpen((value) => !value);

  return (
    <SectionCard
      extra={
        <Icon
          className={stylex.props(styles.chevron, open && styles.chevronOpen).className}
          icon={ChevronDownIcon}
          size={16}
          onClick={toggle}
        />
      }
      title={
        <span
          aria-expanded={open}
          {...stylex.props(styles.header)}
          role={'button'}
          tabIndex={0}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
        >
          {t('oauthApp.integration.endpoints')}
        </span>
      }
    >
      {open && (
        <Flexbox gap={12}>
          <Text style={{ fontSize: 12 }} type={'secondary'}>
            {t('oauthApp.integration.desc')}
          </Text>
          {endpoints.map(({ key, url }) => (
            <Flexbox gap={6} key={key}>
              <span {...stylex.props(styles.label)}>{t(LABEL_KEYS[key])}</span>
              <Flexbox
                horizontal
                align={'center'}
                className={stylex.props(styles.value).className}
                gap={8}
              >
                <Flexbox flex={1}>{url}</Flexbox>
                <CopyButton content={url} size={'small'} title={t('oauthApp.copy.tooltip')} />
              </Flexbox>
            </Flexbox>
          ))}
        </Flexbox>
      )}
    </SectionCard>
  );
};

export default ManualSetupCard;
