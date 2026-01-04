import AsyncStorage from '@react-native-async-storage/async-storage';

const FARMS_STORAGE_KEY = '@saved_farms';

/**
 * Load all saved farms from local storage
 * @returns {Promise<Array>} Array of farm objects
 */
export const loadFarms = async () => {
  try {
    const savedFarms = await AsyncStorage.getItem(FARMS_STORAGE_KEY);
    if (savedFarms !== null) {
      const parsedFarms = JSON.parse(savedFarms);
      console.log(`Loaded ${parsedFarms.length} farms from storage`);
      return parsedFarms;
    }
    return [];
  } catch (error) {
    console.error('Error loading farms:', error);
    return [];
  }
};

/**
 * Save farms to local storage
 * @param {Array} farmsData - Array of farm objects to save
 * @returns {Promise<boolean>} Success status
 */
export const saveFarms = async (farmsData) => {
  try {
    // Strip out heavy heat map grid data to avoid storage limits
    // Heat maps will be regenerated from backend when viewing farm
    const lightweightFarms = farmsData.map(farm => {
      const { backendAnalysis, ...farmWithoutAnalysis } = farm;
      
      if (backendAnalysis) {
        // Keep only metadata, remove heavy grid data
        return {
          ...farmWithoutAnalysis,
          backendAnalysis: {
            metadata: backendAnalysis.metadata,
            dataPointCount: backendAnalysis.dataPointCount,
            processingTimeMs: backendAnalysis.processingTimeMs,
            // Omit solarHeatMapGrid and elevationHeatMapGrid - too large
          }
        };
      }
      
      return farm;
    });
    
    await AsyncStorage.setItem(FARMS_STORAGE_KEY, JSON.stringify(lightweightFarms));
    console.log(`Saved ${lightweightFarms.length} farms to storage (without heat map grids)`);
    return true;
  } catch (error) {
    console.error('Error saving farms:', error);
    return false;
  }
};

/**
 * Delete all farms from local storage
 * @returns {Promise<boolean>} Success status
 */
export const clearFarms = async () => {
  try {
    await AsyncStorage.removeItem(FARMS_STORAGE_KEY);
    console.log('Cleared all farms from storage');
    return true;
  } catch (error) {
    console.error('Error clearing farms:', error);
    return false;
  }
};

/**
 * Get the total count of saved farms without loading all data
 * @returns {Promise<number>} Count of farms
 */
export const getFarmCount = async () => {
  try {
    const savedFarms = await AsyncStorage.getItem(FARMS_STORAGE_KEY);
    if (savedFarms !== null) {
      const parsedFarms = JSON.parse(savedFarms);
      return parsedFarms.length;
    }
    return 0;
  } catch (error) {
    console.error('Error getting farm count:', error);
    return 0;
  }
};
