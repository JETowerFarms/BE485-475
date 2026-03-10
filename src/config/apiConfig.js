// Local emulator backend; release builds should hit your LAN IP so physical devices can reach the host.
const LOCAL_API_DOMAIN = 'http://10.0.2.2:3001';
// Cloud VM backend — served via Nginx HTTPS on besolarfarms.com (static IP 34.68.160.91)
const RELEASE_API_DOMAIN = 'https://besolarfarms.com';

export const API_DOMAIN = __DEV__ ? LOCAL_API_DOMAIN : RELEASE_API_DOMAIN;
export const API_BASE_URL = `${API_DOMAIN}/api`;

export const buildApiUrl = (path = '') => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

/**
 * Authenticated fetch wrapper. Automatically injects the current JWT as a
 * Bearer token. Works for all API calls except the login endpoint itself.
 * Drop-in replacement for fetch() — all existing options are preserved.
 */
import { getToken } from '../utils/authStorage';

export const apiFetch = (url, options = {}) => {
  const token = getToken();
  const headers = {
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return fetch(url, { ...options, headers });
};
