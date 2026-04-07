import { useState, useEffect } from 'react';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

// Fetches the crop catalog once on mount.
export const useCropOptions = () => {
  const [cropOptions, setCropOptions] = useState([]);
  const [cropOptionsLoading, setCropOptionsLoading] = useState(false);
  const [cropOptionsError, setCropOptionsError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setCropOptionsLoading(true);
      setCropOptionsError('');
      try {
        const response = await apiFetch(buildApiUrl('/crops'));
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Backend API error (${response.status}): ${text}`);
        }
        const data = await response.json();
        const crops = Array.isArray(data?.crops) ? data.crops : [];
        if (!cancelled) setCropOptions(crops);
      } catch (e) {
        if (!cancelled) setCropOptionsError(e?.message || 'Failed to load crops');
      } finally {
        if (!cancelled) setCropOptionsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { cropOptions, setCropOptions, cropOptionsLoading, cropOptionsError };
};
