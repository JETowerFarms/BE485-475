import { useCallback } from 'react';
import { buildApiUrl, apiFetch } from '../config/apiConfig';
import { validateCoordinates } from '../utils/geometryUtils';

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

      const rawCoordinates = farm?.geometry?.coordinates?.[0] || [];
      const coordinates =
        rawCoordinates.length > 1 &&
        rawCoordinates[0][0] === rawCoordinates[rawCoordinates.length - 1][0] &&
        rawCoordinates[0][1] === rawCoordinates[rawCoordinates.length - 1][1]
          ? rawCoordinates.slice(0, -1)
          : rawCoordinates;

      validateCoordinates(coordinates);

      if (typeof setModalLoading === 'function') setModalLoading(true);
      updateFarmById(farmId, (current) => ({
        ...current,
        analysisStatus: 'running',
      }));

      try {
        const response = await apiFetch(buildApiUrl('/reports/analyze'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates, userId: 'default-user' }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Backend API error (${response.status}): ${errorText}`);
        }

        const responseText = await response.text();
        let backendAnalysis;
        try {
          backendAnalysis = JSON.parse(responseText);
        } catch (parseError) {
          throw new Error(`Invalid JSON response: ${parseError.message}`);
        }

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
