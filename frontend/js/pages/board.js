// Board: trạng thái tất cả máy. Bấm vào máy để bắt đầu / kết thúc downtime.
//
// SQL phía sau:
//   select * from v_machine_status order by line_code, machine_code;   -- view
//   select start_downtime(...);  select end_downtime(...);             -- RPC
import {
  sb, esc, unwrap, toast, openDialog, elapsed, fmtDateTime, loadReasons, reasonOptions,
} from '../lib.js';

export async function renderBoard(app) {
  app.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Board</h1>
        <div class="muted">Bấm vào máy để ghi nhận dừng máy hoặc báo chạy lại.</div>
      </div>
      <div class="muted" id="summary"></div>
    </div>
    <div id="lines"><p class="muted">Đang tải…</p></div>`;

  const linesEl = app.querySelector('#lines');
  let machines = [];

  async function load() {
    machines = unwrap(await sb
      .from('v_machine_status')
      .select('*')
      .order('line_code')
      .order('machine_code'));
    draw();
  }

  function draw() {
    const down = machines.filter((m) => m.status === 'down').length;
    app.querySelector('#summary').innerHTML = `
      <span class="badge"><span class="dot" style="background:var(--teal)"></span>${machines.length - down} đang chạy</span>
      <span class="badge"><span class="dot" style="background:var(--red)"></span>${down} đang dừng</span>`;

    const byLine = Map.groupBy
      ? Map.groupBy(machines, (m) => m.line_code)
      : machines.reduce((acc, m) => acc.set(m.line_code, [...(acc.get(m.line_code) ?? []), m]), new Map());

    linesEl.innerHTML = [...byLine].map(([line, items]) => `
      <section class="line-group">
        <h2>${esc(line)} <span class="muted" style="font-weight:400">${esc(items[0].line_name)}</span></h2>
        <div class="tiles">
          ${items.map((m) => `
            <button class="tile ${m.status}" data-id="${m.machine_id}">
              <div class="code">${esc(m.machine_code)}</div>
              <div class="name">${esc(m.machine_name)}</div>
              ${m.status === 'down' ? `
                <div class="timer" data-since="${esc(m.down_since)}">${elapsed(m.down_since)}</div>
                <div class="state">● Dừng · ${esc(m.reason_name ?? 'chưa rõ lý do')}</div>` : `
                <div class="state">● Đang chạy</div>`}
            </button>`).join('')}
        </div>
      </section>`).join('') || '<p class="muted">Chưa có máy nào. Chạy supabase/seed.sql hoặc thêm máy ở trang Quản trị.</p>';
  }

  linesEl.addEventListener('click', async (ev) => {
    const tile = ev.target.closest('.tile');
    if (!tile) return;
    const m = machines.find((x) => x.machine_id === Number(tile.dataset.id));
    const reasons = await loadReasons();
    if (m.status === 'running') await startFlow(m, reasons);
    else await endFlow(m, reasons);
  });

  async function startFlow(m, reasons) {
    const form = await openDialog(`
      <form method="dialog">
        <h3>Ghi nhận dừng máy</h3>
        <p class="muted">${esc(m.machine_code)} · ${esc(m.machine_name)}</p>
        <div class="field">
          <label>Lý do (có thể chọn sau)</label>
          <select name="reason_id"><option value="">— Chưa rõ —</option>${reasonOptions(reasons)}</select>
        </div>
        <div class="field"><label>Ghi chú</label><textarea name="note" rows="2"></textarea></div>
        <div class="dialog-actions">
          <button class="btn" value="cancel" formnovalidate>Hủy</button>
          <button class="btn danger" value="ok">Bắt đầu dừng máy</button>
        </div>
      </form>`);
    if (!form) return;
    try {
      unwrap(await sb.rpc('start_downtime', {
        p_machine_id: m.machine_id,
        p_reason_id: form.get('reason_id') ? Number(form.get('reason_id')) : null,
        p_note: form.get('note'),
      }));
      toast(`${m.machine_code} đã chuyển sang trạng thái dừng`);
      await load();
    } catch (err) { toast(err.message, true); }
  }

  async function endFlow(m, reasons) {
    const form = await openDialog(`
      <form method="dialog">
        <h3>Máy chạy lại</h3>
        <p class="muted">${esc(m.machine_code)} · dừng từ ${fmtDateTime(m.down_since)} (${elapsed(m.down_since)})</p>
        <div class="field">
          <label>Lý do dừng *</label>
          <select name="reason_id" required>
            <option value="">— Chọn lý do —</option>${reasonOptions(reasons, m.reason_id)}
          </select>
        </div>
        <div class="field"><label>Ghi chú / cách xử lý</label><textarea name="note" rows="2">${esc(m.note ?? '')}</textarea></div>
        <div class="dialog-actions">
          <a class="btn" href="#/event/${m.open_event_id}" onclick="this.closest('dialog').close()">Chi tiết</a>
          <button class="btn" value="cancel" formnovalidate>Hủy</button>
          <button class="btn primary" value="ok">Kết thúc dừng máy</button>
        </div>
      </form>`);
    if (!form) return;
    try {
      unwrap(await sb.rpc('end_downtime', {
        p_event_id: m.open_event_id,
        p_reason_id: Number(form.get('reason_id')),
        p_note: form.get('note'),
      }));
      toast(`${m.machine_code} đã chạy lại`);
      await load();
    } catch (err) { toast(err.message, true); }
  }

  await load();

  // Cập nhật đồng hồ mỗi giây.
  const tick = setInterval(() => {
    linesEl.querySelectorAll('.timer').forEach((el) => { el.textContent = elapsed(el.dataset.since); });
  }, 1000);

  // Realtime: người khác ghi nhận ở máy khác → board tự cập nhật.
  const channel = sb
    .channel('board-downtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'downtime_events' }, () => load())
    .subscribe();

  return () => {
    clearInterval(tick);
    sb.removeChannel(channel);
  };
}
