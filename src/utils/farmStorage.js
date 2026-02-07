import AsyncStorage from '@react-native-async-storage/async-storage';

const FARMS_STORAGE_KEY = '@saved_farms';

let storageInstance = null;

export function getStorage() {
  // Use AsyncStorage for more reliable persistence
  return AsyncStorage;
}

/**
 * Load all saved farms from local storage
 * @returns {Promise<Array>} Array of farm objects
 */
export const loadFarms = async () => {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const savedFarms = await storage.getItem(FARMS_STORAGE_KEY);
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
  const storage = getStorage();
  if (!storage) return false;
  try {
    await storage.setItem(FARMS_STORAGE_KEY, JSON.stringify(farmsData));
    console.log(`Saved ${farmsData.length} farms to storage (with backend analysis)`);
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
  const storage = getStorage();
  if (!storage) return false;
  try {
    await storage.removeItem(FARMS_STORAGE_KEY);
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
  const storage = getStorage();
  if (!storage) return 0;
  try {
    const savedFarms = await storage.getItem(FARMS_STORAGE_KEY);
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
