// Điểm vào của ứng dụng: xác thực + router dạng hash (#/board, #/event/12 …).
// Dùng hash router vì GitHub Pages chỉ phục vụ file tĩnh, không rewrite URL được.
import { sb, isConfigured, esc } from './lib.js';
import { renderLogin } from './pages/login.js';
import { renderBoard } from './pages/board.js';
import { renderHistory } from './pages/history.js';
import { renderEvent } from './pages/event.js';
import { renderReports } from './pages/reports.js';
import { renderAdmin } from './pages/admin.js';

const routes = {
  board: renderBoard,
  history: renderHistory,
  event: renderEvent,
  reports: renderReports,
  admin: renderAdmin,
};

const app = document.getElementById('app');
const topbar = document.getElementById('topbar');

/** Trạng thái dùng chung giữa các trang. */
export const state = { session: null, profile: null };

// Mỗi trang có thể trả về hàm dọn dẹp (tắt timer, hủy realtime) khi rời trang.
let cleanup = null;

async function loadProfile() {
  const { data } = await sb.from('profiles').select('*').eq('id', state.session.user.id).single();
  state.profile = data;
}

function renderTopbar() {
  topbar.hidden = false;
  const p = state.profile;
  document.getElementById('user').innerHTML = `
    <span class="who">${esc(p?.full_name ?? state.session.user.email)}</span>
    <span class="badge">${esc(p?.role ?? '?')}</span>
    <button class="btn small" id="logout">Đăng xuất</button>`;
  document.getElementById('logout').onclick = () => sb.auth.signOut();
  document.querySelector('[data-route="admin"]').hidden = p?.role !== 'admin';
}

async function router() {
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  if (!isConfigured) {
    app.innerHTML = `
      <div class="panel login">
        <h1>Chưa cấu hình Supabase</h1>
        <p class="muted">Điền <code>SUPABASE_URL</code> và <code>SUPABASE_ANON_KEY</code> trong
        <code>frontend/js/config.js</code> (chạy local) hoặc tạo repository variables cùng tên
        (khi deploy). Xem <code>docs/setup.md</code>.</p>
      </div>`;
    return;
  }

  if (!state.session) {
    topbar.hidden = true;
    renderLogin(app);
    return;
  }

  renderTopbar();
  const [name = 'board', ...params] = location.hash.replace(/^#\/?/, '').split('/');
  const page = routes[name] ?? renderBoard;
  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === (name === 'event' ? 'history' : name));
  });

  try {
    cleanup = await page(app, params, state);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="panel"><h1>Có lỗi</h1><p class="mono">${esc(err.message)}</p></div>`;
  }
}

let booted = false;
if (isConfigured) {
  sb.auth.onAuthStateChange((_event, session) => {
    // Không await Supabase trực tiếp trong callback này (khuyến cáo của supabase-js).
    setTimeout(async () => {
      const changedUser = session?.user?.id !== state.session?.user?.id;
      state.session = session;
      if (!session) state.profile = null;
      else if (changedUser || !state.profile) await loadProfile();
      if (changedUser || !booted) { booted = true; router(); }
    }, 0);
  });
} else {
  router();
}

window.addEventListener('hashchange', router);
