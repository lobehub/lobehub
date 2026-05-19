'use client';

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const CreateIndexRedirect = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/create/image', { replace: true });
  }, [navigate]);

  return null;
};

export default CreateIndexRedirect;
