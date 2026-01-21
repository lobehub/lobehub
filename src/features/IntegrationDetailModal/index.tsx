'use client';

import {
  type KlavisServerType,
  type LobehubSkillProviderType,
  getKlavisServerByServerIdentifier,
  getLobehubSkillProviderById,
} from '@lobechat/const';
import { Flexbox, Icon, Image, Modal, Tag, Text, Typography } from '@lobehub/ui';
import { Button, Divider } from 'antd';
import { createStyles, cssVar } from 'antd-style';
import { ExternalLink, Loader2, SquareArrowOutUpRight } from 'lucide-react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';
import { klavisStoreSelectors, lobehubSkillStoreSelectors } from '@/store/tool/selectors';
import { KlavisServerStatus } from '@/store/tool/slices/klavisStore';
import { LobehubSkillStatus } from '@/store/tool/slices/lobehubSkillStore/types';

const useStyles = createStyles(({ css, token }) => ({
  authorLink: css`
    cursor: pointer;

    display: inline-flex;
    gap: 4px;
    align-items: center;

    color: ${token.colorPrimary};

    &:hover {
      text-decoration: underline;
    }
  `,
  detailItem: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  detailLabel: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  header: css`
    display: flex;
    gap: 16px;
    align-items: center;

    padding: 16px;
    border-radius: 12px;

    background: ${token.colorFillTertiary};
  `,
  icon: css`
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: center;

    width: 56px;
    height: 56px;
    border-radius: 12px;

    background: ${token.colorBgContainer};
  `,
  introduction: css`
    font-size: 14px;
    line-height: 1.8;
    color: ${token.colorText};
  `,
  sectionTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  title: css`
    font-size: 18px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  toolTag: css`
    font-family: ${token.fontFamilyCode};
    font-size: 12px;
  `,
  toolsContainer: css`
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  `,
  trustWarning: css`
    font-size: 12px;
    line-height: 1.6;
    color: ${token.colorTextTertiary};
  `,
}));

export type IntegrationType = 'klavis' | 'lobehub';

export interface IntegrationDetailModalProps {
  identifier: string;
  isConnecting?: boolean;
  onClose: () => void;
  onConnect?: () => void;
  open: boolean;
  type: IntegrationType;
}

const IntegrationDetailModal = memo<IntegrationDetailModalProps>(
  ({ open, onClose, type, identifier, isConnecting, onConnect }) => {
    const { styles } = useStyles();
    const { t } = useTranslation(['plugin', 'setting']);

    // Get static config based on type
    const config = useMemo((): KlavisServerType | LobehubSkillProviderType | undefined => {
      if (type === 'klavis') {
        return getKlavisServerByServerIdentifier(identifier);
      }
      return getLobehubSkillProviderById(identifier);
    }, [type, identifier]);

    // Get dynamic state from store
    const klavisServers = useToolStore(klavisStoreSelectors.getServers);
    const lobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers);

    const serverState = useMemo(() => {
      if (type === 'klavis') {
        return klavisServers.find((s) => s.identifier === identifier);
      }
      return lobehubSkillServers.find((s) => s.identifier === identifier);
    }, [type, identifier, klavisServers, lobehubSkillServers]);

    const isConnected = useMemo(() => {
      if (!serverState) return false;
      if (type === 'klavis') {
        return serverState.status === KlavisServerStatus.CONNECTED;
      }
      return serverState.status === LobehubSkillStatus.CONNECTED;
    }, [type, serverState]);

    const tools = useMemo(() => {
      return serverState?.tools?.map((tool) => tool.name) || [];
    }, [serverState]);

    if (!config) return null;

    const { author, authorUrl, description, icon, introduction, label } = config;

    // Get identifier for i18n keys
    const i18nIdentifier =
      type === 'klavis'
        ? (config as KlavisServerType).identifier
        : (config as LobehubSkillProviderType).id;
    const i18nPrefix = type === 'klavis' ? 'tools.klavis.servers' : 'tools.lobehubSkill.providers';

    const localizedDescription = t(`${i18nPrefix}.${i18nIdentifier}.description`, {
      defaultValue: description,
      ns: 'setting',
    });
    const localizedIntroduction = t(`${i18nPrefix}.${i18nIdentifier}.introduction`, {
      defaultValue: introduction,
      ns: 'setting',
    });

    const renderIcon = () => {
      if (typeof icon === 'string') {
        return <Image alt={label} height={36} src={icon} width={36} />;
      }
      return <Icon fill={cssVar.colorText} icon={icon} size={36} />;
    };

    const handleAuthorClick = () => {
      if (authorUrl) {
        window.open(authorUrl, '_blank', 'noopener,noreferrer');
      }
    };

    const renderConnectButton = () => {
      if (isConnected) return null;
      if (!onConnect) return null;

      if (isConnecting) {
        return (
          <Button disabled icon={<Icon icon={Loader2} spin />} type="default">
            {t('tools.klavis.connect', { defaultValue: 'Connect', ns: 'setting' })}
          </Button>
        );
      }

      return (
        <Button icon={<Icon icon={SquareArrowOutUpRight} />} onClick={onConnect} type="primary">
          {t('tools.klavis.connect', { defaultValue: 'Connect', ns: 'setting' })}
        </Button>
      );
    };

    return (
      <Modal
        destroyOnHidden
        footer={null}
        onCancel={onClose}
        open={open}
        title={t('dev.title.skillDetails')}
        width={800}
      >
        <Flexbox gap={20}>
          {/* Header */}
          <Flexbox
            align="center"
            className={styles.header}
            horizontal
            justify="space-between"
            style={{ flexWrap: 'nowrap' }}
          >
            <Flexbox align="center" gap={16} horizontal>
              <div className={styles.icon}>{renderIcon()}</div>
              <Flexbox gap={4}>
                <span className={styles.title}>{label}</span>
                <Text style={{ fontSize: 14 }} type="secondary">
                  {localizedDescription}
                </Text>
              </Flexbox>
            </Flexbox>
            {renderConnectButton()}
          </Flexbox>

          {/* Introduction */}
          <Typography className={styles.introduction}>{localizedIntroduction}</Typography>

          {/* Developed by */}
          <Flexbox gap={8}>
            <Flexbox align="center" gap={4} horizontal>
              <span className={styles.sectionTitle}>{t('integrationDetail.developedBy')}</span>
              <span
                className={styles.authorLink}
                onClick={handleAuthorClick}
                style={{ cursor: authorUrl ? 'pointer' : 'default' }}
              >
                {author}
                {authorUrl && <Icon icon={ExternalLink} size={12} />}
              </span>
            </Flexbox>
            <Text className={styles.trustWarning} type="secondary">
              {t('integrationDetail.trustWarning')}
            </Text>
          </Flexbox>

          {/* Tools */}
          {tools.length > 0 && (
            <>
              <Divider style={{ margin: 0 }} />
              <Flexbox gap={12}>
                <Flexbox align="center" gap={8} horizontal>
                  <span className={styles.sectionTitle}>{t('integrationDetail.tools')}</span>
                  <Tag>{tools.length}</Tag>
                </Flexbox>
                <div className={styles.toolsContainer}>
                  {tools.map((tool) => (
                    <Tag className={styles.toolTag} key={tool}>
                      {tool}
                    </Tag>
                  ))}
                </div>
              </Flexbox>
            </>
          )}

          {/* Details */}
          <Divider style={{ margin: 0 }} />
          <Flexbox gap={12}>
            <span className={styles.sectionTitle}>{t('integrationDetail.details')}</span>
            <Flexbox gap={16} horizontal>
              <div className={styles.detailItem}>
                <span className={styles.detailLabel}>{t('integrationDetail.author')}</span>
                <span
                  className={styles.authorLink}
                  onClick={handleAuthorClick}
                  style={{ cursor: authorUrl ? 'pointer' : 'default' }}
                >
                  {author}
                  {authorUrl && <Icon icon={ExternalLink} size={12} />}
                </span>
              </div>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </Modal>
    );
  },
);

IntegrationDetailModal.displayName = 'IntegrationDetailModal';

export default IntegrationDetailModal;
