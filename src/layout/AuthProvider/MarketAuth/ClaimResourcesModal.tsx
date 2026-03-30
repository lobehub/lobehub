'use client';

import { Flexbox, Modal, Text } from '@lobehub/ui';
import { App, Checkbox, List } from 'antd';
import { cssVar } from 'antd-style';
import { Package, Wrench } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { lambdaClient } from '@/libs/trpc/client';

import { type ClaimableResource, type ClaimableResources } from './useSocialConnect';

interface ClaimResourcesModalProps {
  onClose: () => void;
  onSuccess?: (claimedCount: number) => void;
  open: boolean;
  resources: ClaimableResources;
}

export const ClaimResourcesModal = memo<ClaimResourcesModalProps>(
  ({ open, onClose, resources, onSuccess }) => {
    const { t } = useTranslation('marketAuth');
    const { message } = App.useApp();

    const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(new Set());
    const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
    const [isClaiming, setIsClaiming] = useState(false);

    useEffect(() => {
      if (!open) {
        setSelectedPlugins(new Set());
        setSelectedSkills(new Set());
        return;
      }

      setSelectedPlugins(new Set(resources.plugins.map((resource) => String(resource.id))));
      setSelectedSkills(new Set(resources.skills.map((resource) => String(resource.id))));
    }, [open, resources]);

    const togglePlugin = useCallback((id: string) => {
      setSelectedPlugins((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    }, []);

    const toggleSkill = useCallback((id: string) => {
      setSelectedSkills((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    }, []);

    const handleClaim = useCallback(async () => {
      const pluginIds = [...selectedPlugins];
      const skillIds = [...selectedSkills];

      if (pluginIds.length === 0 && skillIds.length === 0) {
        onClose();
        return;
      }

      setIsClaiming(true);
      try {
        await lambdaClient.market.socialProfile.claimResources.mutate({
          pluginIds,
          skillIds,
        });

        const totalClaimed = pluginIds.length + skillIds.length;
        message.success(
          t('claimResources.success', {
            count: totalClaimed,
            defaultValue: `Successfully claimed ${totalClaimed} resource(s)`,
          }),
        );
        onSuccess?.(totalClaimed);
        onClose();
      } catch (error) {
        console.error('[ClaimResources] Failed to claim:', error);
        message.error(
          t('claimResources.error', {
            defaultValue: 'Failed to claim resources. Please try again.',
          }),
        );
      } finally {
        setIsClaiming(false);
      }
    }, [selectedPlugins, selectedSkills, message, t, onSuccess, onClose]);

    const totalSelected = selectedPlugins.size + selectedSkills.size;

    const renderItem = (
      item: ClaimableResource,
      selected: boolean,
      onToggle: () => void,
      icon: React.ReactNode,
    ) => {
      // Use name, or fallback to parsedUrl.fullName, or identifier
      const displayName = item.name || item.parsedUrl?.fullName || item.identifier;

      return (
        <List.Item
          style={{
            cursor: 'pointer',
            padding: '8px 12px',
          }}
          onClick={onToggle}
        >
          <Flexbox horizontal align="center" gap={12} style={{ width: '100%' }}>
            <Checkbox checked={selected} />
            {icon}
            <Flexbox flex={1} gap={2}>
              <Text style={{ fontSize: 14 }}>{displayName}</Text>
              {item.description && (
                <Text style={{ fontSize: 12 }} type="secondary">
                  {item.description}
                </Text>
              )}
            </Flexbox>
          </Flexbox>
        </List.Item>
      );
    };

    return (
      <Modal
        centered
        cancelText={t('claimResources.skip', { defaultValue: 'Skip' })}
        confirmLoading={isClaiming}
        okText={t('claimResources.claim', { defaultValue: 'Claim Selected' })}
        open={open}
        title={false}
        width={480}
        onCancel={onClose}
        onOk={handleClaim}
      >
        <Text strong fontSize={20} style={{ display: 'block', marginBottom: 8, marginTop: 16 }}>
          {t('claimResources.title', { defaultValue: 'Claim Your Resources' })}
        </Text>
        <Text style={{ display: 'block', marginBottom: 16 }} type="secondary">
          {t('claimResources.description', {
            defaultValue: 'We found resources linked to your account that you can claim:',
          })}
        </Text>

        {resources.plugins.length > 0 && (
          <Flexbox gap={8} style={{ marginBottom: 16 }}>
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('claimResources.pluginSection', { defaultValue: 'Plugins' })}
            </Text>
            <List
              bordered
              dataSource={resources.plugins}
              size="small"
              style={{ borderRadius: cssVar.borderRadiusLG }}
              renderItem={(item) =>
                renderItem(
                  item,
                  selectedPlugins.has(String(item.id)),
                  () => togglePlugin(String(item.id)),
                  <Package size={18} style={{ color: cssVar.colorTextSecondary }} />,
                )
              }
            />
          </Flexbox>
        )}

        {resources.skills.length > 0 && (
          <Flexbox gap={8}>
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('claimResources.skillSection', { defaultValue: 'Skills' })}
            </Text>
            <List
              bordered
              dataSource={resources.skills}
              size="small"
              style={{ borderRadius: cssVar.borderRadiusLG }}
              renderItem={(item) =>
                renderItem(
                  item,
                  selectedSkills.has(String(item.id)),
                  () => toggleSkill(String(item.id)),
                  <Wrench size={18} style={{ color: cssVar.colorTextSecondary }} />,
                )
              }
            />
          </Flexbox>
        )}

        {totalSelected > 0 && (
          <Text style={{ display: 'block', fontSize: 12, marginTop: 12 }} type="secondary">
            {t('claimResources.selectedCount', {
              count: totalSelected,
              defaultValue: `${totalSelected} item(s) selected`,
            })}
          </Text>
        )}
      </Modal>
    );
  },
);

ClaimResourcesModal.displayName = 'ClaimResourcesModal';

export default ClaimResourcesModal;
