'use client';

import { Flexbox } from '@lobehub/ui';
import { Select } from 'antd';
import { memo, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const GenerationTypeSelector = memo(() => {
  const navigate = useNavigate();
  const location = useLocation();

  const options = [
    { label: '🖼️ Image', value: 'image' },
    { label: '🎬 Video', value: 'video' },
    { label: '🎵 Audio', value: 'audio' },
  ];

  const currentType = useMemo(() => {
    if (location.pathname.includes('/image')) return 'image';
    if (location.pathname.includes('/video')) return 'video';
    if (location.pathname.includes('/audio')) return 'audio';
    return 'image';
  }, [location.pathname]);

  const handleChange = (value: string) => {
    navigate(`/create/${value}`);
  };

  return (
    <Flexbox padding="md" horizontal>
      <label style={{ marginRight: '8px', fontWeight: 500 }}>Generation Type:</label>
      <Select
        value={currentType}
        onChange={handleChange}
        options={options}
        style={{ width: '150px' }}
      />
    </Flexbox>
  );
});

GenerationTypeSelector.displayName = 'GenerationTypeSelector';

export default GenerationTypeSelector;
