import { useState, useEffect } from 'react';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

// Fetches incentive catalog; calls onDefaultIds(ids) to pre-select all.
export const useIncentiveCatalog = (onDefaultIds) => {
  const [incentiveCatalog, setIncentiveCatalog] = useState([]);
  const [incentivesLoading, setIncentivesLoading] = useState(false);
  const [incentivesError, setIncentivesError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIncentivesLoading(true);
      try {
        const resp = await apiFetch(buildApiUrl('/linear-optimization/incentives'));
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!cancelled && Array.isArray(data?.incentives)) {
          setIncentiveCatalog(data.incentives);
          if (typeof onDefaultIds === 'function') {
            onDefaultIds(data.incentives.map((i) => i.id));
          }
        }
      } catch (err) {
        if (!cancelled)
          setIncentivesError(err?.message || 'Could not load incentives');
      } finally {
        if (!cancelled) setIncentivesLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { incentiveCatalog, incentivesLoading, incentivesError };
};
