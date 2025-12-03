import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

const FARMS_STORAGE_KEY = '@saved_farms';
const USER_ID_KEY = '@user_id';

/**
 * Get or create a unique user ID for this device
 * @returns {Promise<string>} User ID
 */
export const getUserId = async () => {
  try {
    let userId = await AsyncStorage.getItem(USER_ID_KEY);
    if (!userId) {
      // Generate a unique ID for this device
      userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      await AsyncStorage.setItem(USER_ID_KEY, userId);
    }
    return userId;
  } catch (error) {
    console.error('Error getting user ID:', error);
    return `temp_${Date.now()}`;
  }
};

/**
 * Load all saved farms from backend API
 * Falls back to local storage if API is unavailable
 * @returns {Promise<Array>} Array of farm objects
 */
export const loadFarms = async () => {
  try {
    const userId = await getUserId();

    // Try to fetch from API
    try {
      const response = await api.getFarms(userId);
      if (response.success && Array.isArray(response.data)) {
        console.log(`Loaded ${response.data.length} farms from API`);
        
        // Sync to local storage as backup
        await AsyncStorage.setItem(FARMS_STORAGE_KEY, JSON.stringify(response.data));
        
        return response.data;
      }
    } catch (apiError) {
      console.warn('Failed to load farms from API, using local storage:', apiError.message);
    }

    // Fallback to local storage
    const savedFarms = await AsyncStorage.getItem(FARMS_STORAGE_KEY);
    if (savedFarms !== null) {
      const parsedFarms = JSON.parse(savedFarms);
      console.log(`Loaded ${parsedFarms.length} farms from local storage`);
      return parsedFarms;
    }

    return [];
  } catch (error) {
    console.error('Error loading farms:', error);
    return [];
  }
};

/**
 * Save a new farm to backend API and local storage
 * @param {Object} farmData - Farm data {name, coordinates, areaAcres}
 * @returns {Promise<Object|null>} Created farm object or null
 */
export const saveFarm = async (farmData) => {
  try {
    const userId = await getUserId();

    // Try to save to API
    try {
      const response = await api.createFarm({
        userId,
        name: farmData.name,
        coordinates: farmData.coordinates,
        areaAcres: farmData.areaAcres,
      });

      if (response.success && response.data) {
        console.log('Farm saved to API:', response.data.id);

        // Update local storage
        const existingFarms = await loadFarms();
        const updatedFarms = [...existingFarms, response.data];
        await AsyncStorage.setItem(FARMS_STORAGE_KEY, JSON.stringify(updatedFarms));

        return response.data;
      }
    } catch (apiError) {
      console.warn('Failed to save farm to API, using local storage only:', apiError.message);
    }

    // Fallback to local storage only
    const farm = {
      id: `local_${Date.now()}`,
      userId,
      name: farmData.name,
      coordinates: farmData.coordinates,
      areaAcres: farmData.areaAcres,
      boundary: {
        type: 'Polygon',
        coordinates: [farmData.coordinates],
      },
      createdAt: new Date().toISOString(),
    };

    const existingFarms = await loadFarms();
    const updatedFarms = [...existingFarms, farm];
    await AsyncStorage.setItem(FARMS_STORAGE_KEY, JSON.stringify(updatedFarms));

    console.log('Farm saved to local storage');
    return farm;
  } catch (error) {
    console.error('Error saving farm:', error);
    return null;
  }
};

/**
 * Save farms array to local storage (legacy compatibility)
 * @param {Array} farmsData - Array of farm objects to save
 * @returns {Promise<boolean>} Success status
 */
export const saveFarms = async (farmsData) => {
  try {
    await AsyncStorage.setItem(FARMS_STORAGE_KEY, JSON.stringify(farmsData));
    console.log(`Saved ${farmsData.length} farms to local storage`);
    return true;
  } catch (error) {
    console.error('Error saving farms:', error);
    return false;
  }
};

/**
 * Delete a farm from backend API and local storage
 * @param {number|string} farmId - Farm ID
 * @returns {Promise<boolean>} Success status
 */
export const deleteFarm = async (farmId) => {
  try {
    const userId = await getUserId();

    // Try to delete from API (only if it's a numeric ID from API)
    if (typeof farmId === 'number' || !farmId.toString().startsWith('local_')) {
      try {
        await api.deleteFarm(farmId, userId);
        console.log('Farm deleted from API:', farmId);
      } catch (apiError) {
        console.warn('Failed to delete farm from API:', apiError.message);
      }
    }

    // Delete from local storage
    const existingFarms = await loadFarms();
    const updatedFarms = existingFarms.filter((f) => f.id !== farmId);
    await AsyncStorage.setItem(FARMS_STORAGE_KEY, JSON.stringify(updatedFarms));

    console.log('Farm deleted from local storage');
    return true;
  } catch (error) {
    console.error('Error deleting farm:', error);
    return false;
  }
};

/**
 * Get detailed analysis for a farm
 * @param {number} farmId - Farm ID
 * @returns {Promise<Object|null>} Farm analysis data
 */
export const getFarmAnalysis = async (farmId) => {
  try {
    const response = await api.getFarmAnalysis(farmId);
    if (response.success && response.data) {
      return response.data;
    }
    return null;
  } catch (error) {
    console.warn('Failed to load farm analysis:', error.message);
    return null;
  }
};

/**
 * Delete all farms from backend and local storage
 * @returns {Promise<boolean>} Success status
 */
export const clearFarms = async () => {
  try {
    // Note: This only clears local storage
    // Individual API farm deletions would need to be done separately
    await AsyncStorage.removeItem(FARMS_STORAGE_KEY);
    console.log('Cleared all farms from local storage');
    return true;
  } catch (error) {
    console.error('Error clearing farms:', error);
    return false;
  }
};

/**
 * Sync local farms to backend API
 * Useful for migrating existing local farms to the server
 * @returns {Promise<number>} Number of farms synced
 */
export const syncFarmsToAPI = async () => {
  try {
    const userId = await getUserId();
    const localFarms = await AsyncStorage.getItem(FARMS_STORAGE_KEY);

    if (!localFarms) {
      return 0;
    }

    const farms = JSON.parse(localFarms);
    let syncedCount = 0;

    for (const farm of farms) {
      // Skip farms that are already synced (have numeric IDs)
      if (typeof farm.id === 'number' || !farm.id.toString().startsWith('local_')) {
        continue;
      }

      try {
        await api.createFarm({
          userId,
          name: farm.name,
          coordinates: farm.coordinates || farm.boundary?.coordinates?.[0],
          areaAcres: farm.areaAcres,
        });
        syncedCount++;
      } catch (error) {
        console.warn(`Failed to sync farm ${farm.id}:`, error.message);
      }
    }

    if (syncedCount > 0) {
      // Reload from API to get updated IDs
      await loadFarms();
    }

    console.log(`Synced ${syncedCount} farms to API`);
    return syncedCount;
  } catch (error) {
    console.error('Error syncing farms to API:', error);
    return 0;
  }
};
