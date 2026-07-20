import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL?.trim();
export const API_BASE = BACKEND_URL ? `${BACKEND_URL}/api` : "/api";

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("recon_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("recon_token");
      if (window.location.pathname !== "/auth") window.location.href = "/auth";
    }
    return Promise.reject(err);
  }
);
