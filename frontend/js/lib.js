// Kết nối Supabase + các hàm tiện ích dùng chung.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = !SUPABASE_URL.includes('YOUR-PROJECT-REF');

export const sb = isConfigured ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const BUCKET = 'downtime-files';

/** Escape chuỗi trước khi chèn vào HTML (chống XSS). */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

/** Ném lỗi nếu Supabase trả về error, ngược lại trả về data. */
export function unwrap({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

const dtf = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit',
  hour: '2-digit', minute: '2-digit',
});
export const fmtDateTime = (iso) => (iso ? dtf.format(new Date(iso)) : '—');

export function fmtMinutes(min) {
  if (min == null) return '—';
  const m = Math.round(Number(min));
  if (m < 60) return `${m} phút`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Đồng hồ đếm từ thời điểm `iso` tới hiện tại, dạng HH:MM:SS. */
export function elapsed(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso)) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** Ngày dạng YYYY-MM-DD theo giờ Việt Nam (cho input type=date). */
export function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
}

/** Đổi ngày YYYY-MM-DD (giờ VN) thành ISO timestamp đầu ngày. */
export const dayStartIso = (ymd) => new Date(`${ymd}T00:00:00+07:00`).toISOString();

let toastTimer;
export function toast(message, isError = false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

/**
 * Mở dialog với nội dung HTML. Trả về Promise<FormData | null>.
 * Nội dung nên chứa <form method="dialog"> và nút submit value="ok".
 */
export function openDialog(html) {
  const dlg = document.getElementById('dialog');
  dlg.innerHTML = html;
  dlg.showModal();
  return new Promise((resolve) => {
    const form = dlg.querySelector('form');
    form.addEventListener('submit', (ev) => {
      const ok = ev.submitter?.value === 'ok';
      resolve(ok ? new FormData(form) : null);
    }, { once: true });
    dlg.addEventListener('cancel', () => resolve(null), { once: true });
  });
}

export function reasonOptions(reasons, selectedId) {
  const groups = new Map();
  for (const r of reasons) {
    const key = r.downtime_categories?.name ?? 'Khác';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups].map(([cat, items]) => `
    <optgroup label="${esc(cat)}">
      ${items.map((r) => `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${esc(r.code)} · ${esc(r.name)}</option>`).join('')}
    </optgroup>`).join('');
}

let reasonsCache;
export async function loadReasons() {
  reasonsCache ??= unwrap(await sb
    .from('downtime_reasons')
    .select('id, code, name, downtime_categories(name, kind)')
    .eq('is_active', true)
    .order('code'));
  return reasonsCache;
}
export const clearReasonsCache = () => { reasonsCache = undefined; };
