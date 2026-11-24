import { ApiError } from './apiError.js';
export { ApiError };

const TOKEN_KEY = 'inkwell.token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return memToken; }
};
let memToken = null;
export const setToken = (t) => {
  memToken = t;
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};

async function request(method, path, body) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, 'You appear to be offline. Changes will save when you reconnect.');
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('inkwell:unauthorized'));
    throw new ApiError(res.status, data.error || `Request failed (${res.status}).`, data);
  }
  return data;
}

const fileForm = (file) => {
  const fd = new FormData();
  fd.append('file', file);
  return fd;
};
const enc = encodeURIComponent;

const httpApi = {
  login: (email, password) => request('POST', '/auth/login', { email, password }),
  logout: () => request('POST', '/auth/logout'),
  me: () => request('GET', '/me'),
  users: () => request('GET', '/users'),
  listDocs: () => request('GET', '/documents'),
  createDoc: (data = {}) => request('POST', '/documents', data),
  getDoc: (id) => request('GET', `/documents/${enc(id)}`),
  updateDoc: (id, data) => request('PATCH', `/documents/${enc(id)}`, data),
  deleteDoc: (id) => request('DELETE', `/documents/${enc(id)}`),
  importDoc: (file) => request('POST', '/documents/import', fileForm(file)),
  convertFile: (file) => request('POST', '/import/convert', fileForm(file)),
  share: (id, email, role) => request('POST', `/documents/${enc(id)}/shares`, { email, role }),
  unshare: (id, userId) => request('DELETE', `/documents/${enc(id)}/shares/${enc(userId)}`),
  heartbeat: (id) => request('POST', `/documents/${enc(id)}/heartbeat`),
  versions: (id) => request('GET', `/documents/${enc(id)}/versions`),
  version: (id, n) => request('GET', `/documents/${enc(id)}/versions/${enc(n)}`),
  restoreVersion: (id, n) => request('POST', `/documents/${enc(id)}/versions/${enc(n)}/restore`),
  comments: (id) => request('GET', `/documents/${enc(id)}/comments`),
  addComment: (id, data) => request('POST', `/documents/${enc(id)}/comments`, data),
  resolveComment: (id, cid, resolved) => request('PATCH', `/documents/${enc(id)}/comments/${enc(cid)}`, { resolved }),
  deleteComment: (id, cid) => request('DELETE', `/documents/${enc(id)}/comments/${enc(cid)}`),
};

// `npm run build:demo` swaps the HTTP client for an in-browser backend that runs the same
// service code as the server (see demoApi.js). In the normal build this branch is compiled away.
export const IS_DEMO = Boolean(import.meta.env.VITE_DEMO);
export const api = import.meta.env.VITE_DEMO
  ? new Proxy({}, { get: (_t, k) => (...a) => import('./demoApi.js').then((m) => m.demoApi[k](...a)) })
  : httpApi;

export const ACCEPTED_FILES = '.txt,.md,.markdown,.docx';
export const ACCEPTED_LABEL = '.txt, .md or .docx file (up to 4 MB)';
