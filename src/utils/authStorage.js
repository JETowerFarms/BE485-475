import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@auth_token';

// In-memory cache so synchronous getToken() works after loadToken() has run
let _memoryToken = null;

/**
 * Persist token to storage and cache it in memory.
 * Pass null to clear (logout).
 */
export const setToken = async (token) => {
  _memoryToken = token;
  try {
    if (token) {
      await AsyncStorage.setItem(STORAGE_KEY, token);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[authStorage] Failed to persist token:', err);
  }
};

/**
 * Load token from storage into memory cache.
 * Call once on app startup before rendering any authenticated screens.
 */
export const loadToken = async () => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    _memoryToken = stored;
    return stored;
  } catch (err) {
    console.warn('[authStorage] Failed to load token:', err);
    return null;
  }
};

/**
 * Synchronous read from in-memory cache.
 * Only valid after loadToken() has been awaited.
 */
export const getToken = () => _memoryToken;
