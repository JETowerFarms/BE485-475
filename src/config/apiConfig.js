// Use local backend when developing on emulator; fall back to production domain otherwise.
const LOCAL_API_DOMAIN = 'http://10.0.2.2:3001';
export const API_DOMAIN = __DEV__ ? LOCAL_API_DOMAIN : 'https://polyfarmbe487.com';
export const API_BASE_URL = `${API_DOMAIN}/api`;

export const buildApiUrl = (path = '') => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};
