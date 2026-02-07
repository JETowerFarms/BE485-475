import { createMMKV } from 'react-native-mmkv';

const LOCATION_STORAGE_KEY = '@saved_location';

let storageInstance = null;

export function getStorage() {
  if (__DEV__) {
    console.log('nativeCallSyncHook exists:', global.nativeCallSyncHook != null);
  }
  if (storageInstance) return storageInstance;

  try {
    storageInstance = createMMKV();

    if (__DEV__) {
      storageInstance.set('__mmkv_test__', '1');
      console.log('MMKV ok:', storageInstance.getString('__mmkv_test__'));
    }

    return storageInstance;
  } catch (error) {
    console.warn('MMKV init failed:', error?.message ?? error);
    storageInstance = null;
    return null;
  }
}

/**
 * Save selected county and city to local storage
 * @param {string} county - Selected county name
 * @param {string} city - Selected city name
 * @returns {Promise<boolean>} Success status
 */
export const saveLocation = async (county, city) => {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const locationData = { county, city };
    storage.set(LOCATION_STORAGE_KEY, JSON.stringify(locationData));
    console.log(`Saved location: ${city}, ${county}`);
    return true;
  } catch (error) {
    console.error('Error saving location:', error);
    return false;
  }
};

/**
 * Load saved county and city from local storage
 * @returns {Promise<{county: string|null, city: string|null}>} Saved location data
 */
export const loadLocation = async () => {
  const storage = getStorage();
  if (!storage) return { county: null, city: null };
  try {
    const savedLocation = storage.getString(LOCATION_STORAGE_KEY);
    if (savedLocation !== undefined) {
      const parsedLocation = JSON.parse(savedLocation);
      console.log(`Loaded location: ${parsedLocation.city}, ${parsedLocation.county}`);
      return parsedLocation;
    }
    return { county: null, city: null };
  } catch (error) {
    console.error('Error loading location:', error);
    return { county: null, city: null };
  }
};

/**
 * Clear saved location from local storage
 * @returns {Promise<boolean>} Success status
 */
export const clearLocation = async () => {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.delete(LOCATION_STORAGE_KEY);
    console.log('Cleared saved location');
    return true;
  } catch (error) {
    console.error('Error clearing location:', error);
    return false;
  }
};
