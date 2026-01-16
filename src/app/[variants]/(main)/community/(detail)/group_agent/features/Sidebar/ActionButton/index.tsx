import { ActionIcon, Button } from '@lobehub/ui';
import { Dropdown } from 'antd';
import { MoreVertical, Plus, Share2 } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { message } from '@/components/AntdStaticMethods';
import { useDetailData } from '../../DetailProvider';

const ActionButton = memo(() => {
  const { t } = useTranslation('discover');
  const data = useDetailData();
  const [loading, setLoading] = useState(false);

  const { group } = data;

  const handleAddGroupAgent = async () => {
    try {
      setLoading(true);
      message.loading({
        content: t('addingGroupAgent', { defaultValue: 'Adding group agent...' }),
        key: 'add-group',
      });

      // TODO: Implement add group agent logic
      // This is a placeholder - actual implementation will depend on:
      // 1. How to create local group
      // 2. How to handle member agents (create locally or reference remotely)
      // 3. Navigation after adding

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Simulate API call

      message.success({
        content: t('groupAgentAdded', { defaultValue: 'Group agent added successfully!' }),
        key: 'add-group',
      });

      // TODO: Navigate to group chat or profile
      // navigate(`/group/${newGroupId}`);
    } catch (error) {
      message.error({
        content: t('addGroupAgentFailed', {
          defaultValue: 'Failed to add group agent',
        }),
        key: 'add-group',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleShare = () => {
    const url = window.location.href;
    if (navigator.share) {
      navigator
        .share({
          text: data.currentVersion?.description,
          title: data.currentVersion?.name || group.name,
          url,
        })
        .catch(() => {
          // Fallback to copy
          navigator.clipboard.writeText(url);
          message.success(t('linkCopied', { defaultValue: 'Link copied to clipboard' }));
        });
    } else {
      navigator.clipboard.writeText(url);
      message.success(t('linkCopied', { defaultValue: 'Link copied to clipboard' }));
    }
  };

  const dropdownItems = [
    {
      key: 'add',
      label: t('addGroupAgent', { defaultValue: 'Add Group Agent' }),
      onClick: handleAddGroupAgent,
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      {/* Primary Action - Add and Converse */}
      <Button
        block
        icon={Plus}
        loading={loading}
        onClick={handleAddGroupAgent}
        size="large"
        type="primary"
      >
        {t('addAndConverse', { defaultValue: 'Add & Start Conversation' })}
      </Button>

      {/* Secondary Actions */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Dropdown menu={{ items: dropdownItems }} placement="bottomRight" trigger={['click']}>
          <Button block icon={MoreVertical}>
            {t('more', { defaultValue: 'More' })}
          </Button>
        </Dropdown>

        <ActionIcon
          icon={Share2}
          onClick={handleShare}
          size="large"
          style={{ flex: 'none' }}
          title={t('share', { defaultValue: 'Share' })}
        />
      </div>
    </div>
  );
});

export default ActionButton;
