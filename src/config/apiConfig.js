// Local emulator backend; release builds should hit your LAN IP so physical devices can reach the host.
const LOCAL_API_DOMAIN = 'http://10.0.2.2:3001';
// Cloud VM backend (Google Compute Engine solar-api, us-central1-c)
// Static IP - reserved in GCP as 'solar-api-static-ip', will not change on VM restart
const RELEASE_API_DOMAIN = 'http://34.68.160.91:3001';

export const API_DOMAIN = __DEV__ ? LOCAL_API_DOMAIN : RELEASE_API_DOMAIN;
export const API_BASE_URL = `${API_DOMAIN}/api`;

export const buildApiUrl = (path = '') => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};
