'use client';

import { Checkbox, cssVar, Flexbox, Text, toast } from '@lobehub/ui';
import { Package, Wrench } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ImperativeModal from '@/components/ImperativeModal';
import { usePermission } from '@/hooks/usePermission';
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

    const { allowed: canCreate } = usePermission('create_content');

    const [selectedPlugins, setSelectedPlugins] = useState<Set<string>>(() => new Set());
    const [selectedSkills, setSelectedSkills] = useState<Set<string>>(() => new Set());
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
      if (!canCreate) return;
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
        toast.success(
          t('claimResources.success', {
            count: totalClaimed,
            defaultValue: `Successfully claimed ${totalClaimed} resource(s)`,
          }),
        );
        onSuccess?.(totalClaimed);
        onClose();
      } catch (error) {
        console.error('[ClaimResources] Failed to claim:', error);
        toast.error(
          t('claimResources.error', {
            defaultValue: 'Failed to claim resources. Please try again.',
          }),
        );
      } finally {
        setIsClaiming(false);
      }
    }, [canCreate, selectedPlugins, selectedSkills, t, onSuccess, onClose]);

    const totalSelected = selectedPlugins.size + selectedSkills.size;

    const renderItem = (
      item: ClaimableResource,
      index: number,
      selected: boolean,
      onToggle: () => void,
      icon: React.ReactNode,
    ) => {
      // Use name, or fallback to parsedUrl.fullName, or identifier
      const displayName = item.name || item.parsedUrl?.fullName || item.identifier;

      return (
        <Flexbox
          horizontal
          align="center"
          gap={12}
          key={item.id}
          style={{
            borderBlockStart: index > 0 ? `1px solid ${cssVar.colorSplit}` : undefined,
            cursor: 'pointer',
            padding: '8px 12px',
            width: '100%',
          }}
          onClick={onToggle}
        >
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
      );
    };

    return (
      <ImperativeModal
        centered
        cancelText={t('claimResources.skip', { defaultValue: 'Skip' })}
        confirmLoading={isClaiming}
        okButtonProps={{ disabled: !canCreate }}
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
            <Flexbox
              style={{
                border: `1px solid ${cssVar.colorBorder}`,
                borderRadius: cssVar.borderRadiusLG,
              }}
            >
              {resources.plugins.map((item, index) =>
                renderItem(
                  item,
                  index,
                  selectedPlugins.has(String(item.id)),
                  () => togglePlugin(String(item.id)),
                  <Package size={18} style={{ color: cssVar.colorTextSecondary }} />,
                ),
              )}
            </Flexbox>
          </Flexbox>
        )}

        {resources.skills.length > 0 && (
          <Flexbox gap={8}>
            <Text style={{ fontSize: 13 }} type="secondary">
              {t('claimResources.skillSection', { defaultValue: 'Skills' })}
            </Text>
            <Flexbox
              style={{
                border: `1px solid ${cssVar.colorBorder}`,
                borderRadius: cssVar.borderRadiusLG,
              }}
            >
              {resources.skills.map((item, index) =>
                renderItem(
                  item,
                  index,
                  selectedSkills.has(String(item.id)),
                  () => toggleSkill(String(item.id)),
                  <Wrench size={18} style={{ color: cssVar.colorTextSecondary }} />,
                ),
              )}
            </Flexbox>
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
      </ImperativeModal>
    );
  },
);

ClaimResourcesModal.displayName = 'ClaimResourcesModal';

export default ClaimResourcesModal;
