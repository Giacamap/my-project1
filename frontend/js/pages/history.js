// Lịch sử downtime có bộ lọc.
//
// Câu query supabase-js bên dưới tương đương SQL:
//   select * from v_downtime_events
//   where started_at >= :from and started_at < :to
//     [and line_id = :line] [and is_open]
//   order by started_at desc
//   limit 500;
import {
  sb, esc, unwrap, fmtDateTime, fmtMinutes, localDate, dayStartIso,
} from '../lib.js';

export async function renderHistory(app) {
  const today = localDate();
  const weekAgo = localDate(new Date(Date.now() - 6 * 864e5));
  const lines = unwrap(await sb.from('lines').select('id, code').order('code'));

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Lịch sử downtime</h1><div class="muted" id="count"></div></div>
      <button class="btn" id="csv">Xuất CSV</button>
    </div>
    <form class="panel row" id="filters" style="margin-bottom:16px">
      <div class="field"><label>Từ ngày</label><input type="date" name="from" value="${weekAgo}"></div>
      <div class="field"><label>Đến ngày</label><input type="date" name="to" value="${today}"></div>
      <div class="field"><label>Line</label>
        <select name="line"><option value="">Tất cả</option>
          ${lines.map((l) => `<option value="${l.id}">${esc(l.code)}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="flex:0 0 auto">
        <label><input type="checkbox" name="open" style="width:auto"> Chỉ đang dừng</label>
      </div>
      <button class="btn primary">Lọc</button>
    </form>
    <div class="table-wrap"><table>
      <thead><tr>
        <th>#</th><th>Bắt đầu</th><th>Kết thúc</th><th class="num">Thời lượng</th>
        <th>Máy</th><th>Ca</th><th>Lý do</th><th>Người báo</th>
      </tr></thead>
      <tbody id="rows"><tr><td colspan="8" class="muted">Đang tải…</td></tr></tbody>
    </table></div>`;

  const form = app.querySelector('#filters');
  let rows = [];

  async function load() {
    const f = new FormData(form);
    const to = new Date(dayStartIso(f.get('to')));
    to.setDate(to.getDate() + 1); // hết ngày "đến"

    let q = sb.from('v_downtime_events')
      .select('*')
      .gte('started_at', dayStartIso(f.get('from')))
      .lt('started_at', to.toISOString())
      .order('started_at', { ascending: false })
      .limit(500);
    if (f.get('line')) q = q.eq('line_id', Number(f.get('line')));
    if (f.get('open')) q = q.eq('is_open', true);

    rows = unwrap(await q);
    const total = rows.reduce((s, r) => s + Number(r.duration_min || 0), 0);
    app.querySelector('#count').textContent = `${rows.length} lần dừng · tổng ${fmtMinutes(total)}`;
    app.querySelector('#rows').innerHTML = rows.map((r) => `
      <tr class="clickable" data-id="${r.id}">
        <td class="mono">${r.id}</td>
        <td>${fmtDateTime(r.started_at)}</td>
        <td>${r.is_open ? '<span class="badge" style="color:#ff8a8d">đang dừng</span>' : fmtDateTime(r.ended_at)}</td>
        <td class="num">${fmtMinutes(r.duration_min)}</td>
        <td><span class="mono">${esc(r.machine_code)}</span></td>
        <td>${esc(r.shift_code ?? '')}</td>
        <td>${r.reason_name
          ? `<span class="badge"><span class="dot" style="background:${esc(r.category_color)}"></span>${esc(r.reason_name)}</span>`
          : '<span class="muted">chưa phân loại</span>'}</td>
        <td>${esc(r.reported_by_name ?? '—')}</td>
      </tr>`).join('') || '<tr><td colspan="8" class="muted">Không có dữ liệu</td></tr>';
  }

  form.onsubmit = (ev) => { ev.preventDefault(); load(); };
  app.querySelector('#rows').onclick = (ev) => {
    const tr = ev.target.closest('tr[data-id]');
    if (tr) location.hash = `#/event/${tr.dataset.id}`;
  };
  app.querySelector('#csv').onclick = () => {
    const cols = ['id', 'started_at', 'ended_at', 'duration_min', 'line_code', 'machine_code',
      'shift_code', 'category_name', 'reason_code', 'reason_name', 'note', 'reported_by_name'];
    const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => quote(r[c])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
    a.download = `downtime_${new FormData(form).get('from')}_${new FormData(form).get('to')}.csv`;
    a.click();
  };

  await load();
}
