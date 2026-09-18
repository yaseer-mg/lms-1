import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

const apiClient = axios.create({
  baseURL:         import.meta.env.VITE_API_URL || '/api/v1',
  withCredentials: true,
});

// Attach access token + idempotency key for mutations
const idempotent = ['post', 'put', 'patch', 'delete'];
const genId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;

  if (idempotent.includes((config.method || 'get').toLowerCase())) {
    if (config.data instanceof FormData) {
      if (!config.data.get('__opId')) config.data.append('__opId', genId());
      config.headers['Idempotency-Key'] = config.data.get('__opId');
    } else if (config.data && typeof config.data === 'object') {
      config.data.__opId = config.data.__opId || genId();
      config.headers['Idempotency-Key'] = config.data.__opId;
      config.data = { ...config.data, __opId: undefined };
    } else {
      config.headers['Idempotency-Key'] = genId();
    }
  }

  return config;
});

// Auto-refresh on 401
let isRefreshing = false;
let queue        = [];

const processQueue = (err, token = null) => {
  queue.forEach((p) => (err ? p.reject(err) : p.resolve(token)));
  queue = [];
};

apiClient.interceptors.response.use(
  (r) => r,
  async (err) => {
    const orig = err.config;
    // Don't try to auto-refresh on the login endpoint itself
    if (orig.url?.includes('/auth/login')) return Promise.reject(err);
    if (err.response?.status === 401 && !orig._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => queue.push({ resolve, reject }))
          .then((token) => { orig.headers.Authorization = `Bearer ${token}`; return apiClient(orig); });
      }
      orig._retry   = true;
      isRefreshing  = true;
      try {
        const refreshToken = useAuthStore.getState().refreshToken;
        if (!refreshToken) throw new Error('No refresh token');
        const res = await axios.post(`${import.meta.env.VITE_API_URL || '/api/v1'}/auth/refresh`, { refreshToken });
        const { accessToken, refreshToken: newRefresh } = res.data.data;
        useAuthStore.getState().setTokens(accessToken, newRefresh);
        processQueue(null, accessToken);
        orig.headers.Authorization = `Bearer ${accessToken}`;
        return apiClient(orig);
      } catch (e) {
        processQueue(e, null);
        useAuthStore.getState().logout();
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
        return Promise.reject(e);
      } finally {
        isRefreshing = false;
      }
    }
    return Promise.reject(err);
  }
);

export default apiClient;
