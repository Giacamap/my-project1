// Quản trị: phân quyền người dùng + thêm máy + thêm lý do dừng.
// RLS chỉ cho admin ghi vào master data, nên dù ai đó mở được trang này
// thì database vẫn từ chối.
import { sb, esc, unwrap, toast, clearReasonsCache } from '../lib.js';

const ROLES = ['operator', 'technician', 'supervisor', 'admin'];

export async function renderAdmin(app, _params, state) {
  if (state.profile?.role !== 'admin') {
    app.innerHTML = '<div class="panel"><h1>Chỉ dành cho admin</h1></div>';
    return;
  }

  const [users, lines, categories, machines, reasons] = await Promise.all([
    sb.from('profiles').select('id, full_name, role, created_at').order('created_at').then(unwrap),
    sb.from('lines').select('id, code, name').order('code').then(unwrap),
    sb.from('downtime_categories').select('id, code, name').order('code').then(unwrap),
    sb.from('machines').select('code, name, is_active, lines(code)').order('code').then(unwrap),
    sb.from('downtime_reasons').select('code, name, downtime_categories(code)').order('code').then(unwrap),
  ]);

  app.innerHTML = `
    <div class="page-head"><h1>Quản trị</h1></div>

    <h2>Người dùng</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Họ tên</th><th>Ngày tạo</th><th>Quyền</th></tr></thead>
      <tbody>${users.map((u) => `
        <tr><td>${esc(u.full_name)}</td>
          <td>${new Date(u.created_at).toLocaleDateString('vi-VN')}</td>
          <td><select data-user="${u.id}" style="width:auto">
            ${ROLES.map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
          </select></td></tr>`).join('')}
      </tbody>
    </table></div>

    <div class="grid-2">
      <div>
        <h2>Máy (${machines.length})</h2>
        <form class="panel" id="add-machine">
          <div class="row">
            <div class="field"><label>Line</label><select name="line_id">
              ${lines.map((l) => `<option value="${l.id}">${esc(l.code)}</option>`).join('')}</select></div>
            <div class="field"><label>Mã máy</label><input name="code" required placeholder="SMT-L1-PNP2"></div>
          </div>
          <div class="field" style="margin-top:12px"><label>Tên máy</label><input name="name" required></div>
          <button class="btn primary">Thêm máy</button>
        </form>
        <div class="table-wrap" style="margin-top:12px;max-height:320px">
          <table><tbody>${machines.map((m) => `
            <tr><td class="mono">${esc(m.code)}</td><td>${esc(m.name)}</td><td class="muted">${esc(m.lines?.code)}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>

      <div>
        <h2>Lý do dừng (${reasons.length})</h2>
        <form class="panel" id="add-reason">
          <div class="row">
            <div class="field"><label>Nhóm</label><select name="category_id">
              ${categories.map((c) => `<option value="${c.id}">${esc(c.code)} · ${esc(c.name)}</option>`).join('')}</select></div>
            <div class="field"><label>Mã</label><input name="code" required placeholder="MECH-BELT"></div>
          </div>
          <div class="field" style="margin-top:12px"><label>Tên lý do</label><input name="name" required></div>
          <button class="btn primary">Thêm lý do</button>
        </form>
        <div class="table-wrap" style="margin-top:12px;max-height:320px">
          <table><tbody>${reasons.map((r) => `
            <tr><td class="mono">${esc(r.code)}</td><td>${esc(r.name)}</td><td class="muted">${esc(r.downtime_categories?.code)}</td></tr>`).join('')}
          </tbody></table>
        </div>
      </div>
    </div>`;

  app.querySelectorAll('select[data-user]').forEach((sel) => {
    sel.onchange = async () => {
      try {
        unwrap(await sb.rpc('set_user_role', { p_user_id: sel.dataset.user, p_role: sel.value }));
        toast('Đã đổi quyền');
      } catch (err) { toast(err.message, true); }
    };
  });

  const insertForm = (selector, table, numericKey, after) => {
    app.querySelector(selector).onsubmit = async (e) => {
      e.preventDefault();
      const row = Object.fromEntries(new FormData(e.target));
      row[numericKey] = Number(row[numericKey]);
      try {
        unwrap(await sb.from(table).insert(row));
        after?.();
        toast('Đã thêm');
        renderAdmin(app, _params, state);
      } catch (err) { toast(err.message, true); }
    };
  };
  insertForm('#add-machine', 'machines', 'line_id');
  insertForm('#add-reason', 'downtime_reasons', 'category_id', clearReasonsCache);
}
