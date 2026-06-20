// src/public/app.js
export const fmt = (yen) => yen == null ? '—' : yen.toLocaleString('ja-JP') + '円';
export const daysAgo = (d) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : Infinity;
export async function apiFetch(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) { const e = await res.json().catch(() => ({ error: res.statusText })); throw new Error(e.error || res.statusText); }
  return res.json();
}
