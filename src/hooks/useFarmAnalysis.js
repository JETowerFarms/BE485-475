import { useCallback } from 'react';
import { buildApiUrl, apiFetch } from '../config/apiConfig';

// Farm analysis helpers — writes back into farms array via onFarmsUpdate.
export const useFarmAnalysis = (farms, onFarmsUpdate, setModalLoading) => {
  const updateFarmById = useCallback(
    (farmId, updater) => {
      if (!onFarmsUpdate || !farmId) return;
      const nextFarms = (farms || []).map((farm) => {
        if (farm?.id !== farmId) return farm;
        return updater(farm);
      });
      onFarmsUpdate(nextFarms);
    },
    [farms, onFarmsUpdate],
  );

  const refreshFarmAnalysis = useCallback(
    async (farm) => {
      const farmId = farm?.id;
      if (!farmId) return;

      if (typeof setModalLoading === 'function') setModalLoading(true);
      updateFarmById(farmId, (current) => ({
        ...current,
        analysisStatus: 'running',
      }));

      try {
        const response = await apiFetch(buildApiUrl(`/reports/farm/${farmId}`));

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend API error (${response.status}): ${errorText}`);
        }

        const json = await response.json();

        // If pending/running, the worker will pick it up — just update status and return.
        if (json.status !== 'ready') {
          updateFarmById(farmId, (current) => ({
            ...current,
            analysisStatus: json.status === 'running' ? 'running' : 'queued',
          }));
          return;
        }

        const backendAnalysis = json.data;

        updateFarmById(farmId, (current) => ({
          ...current,
          properties: {
            ...current.properties,
            avgSuitability:
              backendAnalysis?.solarSuitability?.summary?.averageSuitability,
          },
          backendAnalysis,
          analysisStatus: 'completed',
        }));
      } catch (error) {
        console.warn('Refresh analysis failed:', error?.message || error);
        updateFarmById(farmId, (current) => ({
          ...current,
          analysisStatus: 'error',
        }));
      } finally {
        if (typeof setModalLoading === 'function') setModalLoading(false);
      }
    },
    [updateFarmById, setModalLoading],
  );

  return { updateFarmById, refreshFarmAnalysis };
};
