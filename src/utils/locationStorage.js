import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCATION_STORAGE_KEY = '@saved_location';

/**
 * Save selected county and city to local storage
 * @param {string} county - Selected county name
 * @param {string} city - Selected city name
 * @returns {Promise<boolean>} Success status
 */
export const saveLocation = async (county, city) => {
  try {
    const locationData = { county, city };
    await AsyncStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(locationData));
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
  try {
    const savedLocation = await AsyncStorage.getItem(LOCATION_STORAGE_KEY);
    if (savedLocation !== null) {
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
  try {
    await AsyncStorage.removeItem(LOCATION_STORAGE_KEY);
    console.log('Cleared saved location');
    return true;
  } catch (error) {
    console.error('Error clearing location:', error);
    return false;
  }
};
