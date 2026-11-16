// Báo cáo: KPI + downtime theo ngày + Pareto lý do.
// Tính toán nằm trong database (RPC downtime_by_day, downtime_pareto),
// frontend chỉ hiển thị.
import { sb, esc, unwrap, fmtMinutes, localDate, dayStartIso } from '../lib.js';

export async function renderReports(app) {
  const today = localDate();
  const monthAgo = localDate(new Date(Date.now() - 29 * 864e5));

  app.innerHTML = `
    <div class="page-head">
      <div><h1>Báo cáo downtime</h1><div class="muted">Tính trong database bằng SQL, xem migrations/0003.</div></div>
      <form class="row" id="range">
        <div class="field"><label>Từ</label><input type="date" name="from" value="${monthAgo}"></div>
        <div class="field"><label>Đến</label><input type="date" name="to" value="${today}"></div>
        <button class="btn primary">Xem</button>
      </form>
    </div>
    <div class="kpis" id="kpis"></div>
    <h2>Downtime theo ngày (phút)</h2>
    <div class="panel"><div class="day-bars" id="days"></div><div class="day-axis" id="axis"></div></div>
    <h2>Pareto theo lý do</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Lý do</th><th>Nhóm</th><th class="num">Số lần</th><th class="num">Tổng</th>
        <th class="num">%</th><th class="num">Tích lũy</th><th></th></tr></thead>
      <tbody id="pareto"></tbody>
    </table></div>`;

  const form = app.querySelector('#range');

  async function load() {
    const f = new FormData(form);
    const from = f.get('from');
    const to = f.get('to');
    const toExclusive = new Date(dayStartIso(to));
    toExclusive.setDate(toExclusive.getDate() + 1);

    const [days, pareto] = await Promise.all([
      sb.rpc('downtime_by_day', { p_from: from, p_to: to }).then(unwrap),
      sb.rpc('downtime_pareto', { p_from: dayStartIso(from), p_to: toExclusive.toISOString() }).then(unwrap),
    ]);

    const totalMin = days.reduce((s, d) => s + Number(d.total_min), 0);
    const events = days.reduce((s, d) => s + Number(d.events), 0);
    const kpi = (label, value, unit = '') => `
      <div class="panel kpi"><div class="label">${label}</div>
      <div class="value">${value} <span class="unit">${unit}</span></div></div>`;
    app.querySelector('#kpis').innerHTML = [
      kpi('Tổng downtime', fmtMinutes(totalMin)),
      kpi('Số lần dừng', events),
      kpi('Thời gian TB / lần (MTTR)', events ? (totalMin / events).toFixed(1) : '—', 'phút'),
      kpi('Lý do lớn nhất', esc(pareto[0]?.reason_code ?? '—'), pareto[0] ? `${pareto[0].pct}%` : ''),
    ].join('');

    const max = Math.max(1, ...days.map((d) => Number(d.total_min)));
    app.querySelector('#days').innerHTML = days.map((d) => `
      <div class="col" style="height:${(100 * d.total_min) / max}%"
           title="${d.day}: ${d.total_min} phút, ${d.events} lần"></div>`).join('');
    app.querySelector('#axis').innerHTML = days.length
      ? `<span>${days[0].day}</span><span>${days.at(-1).day}</span>` : '';

    // Thanh dài nhất = lý do lớn nhất (dễ so sánh hơn % trên tổng).
    const maxMin = Math.max(1, ...pareto.map((p) => Number(p.total_min)));
    app.querySelector('#pareto').innerHTML = pareto.map((p) => `
      <tr>
        <td><span class="mono">${esc(p.reason_code)}</span> ${esc(p.reason_name)}</td>
        <td><span class="badge"><span class="dot" style="background:${esc(p.category_color)}"></span>${esc(p.category_name ?? '—')}</span></td>
        <td class="num">${p.events}</td>
        <td class="num">${fmtMinutes(p.total_min)}</td>
        <td class="num">${p.pct}%</td>
        <td class="num">${p.cumulative_pct}%</td>
        <td class="bar-cell"><div class="bar"><span style="width:${(100 * p.total_min) / maxMin}%;background:${esc(p.category_color)}"></span></div></td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Không có dữ liệu</td></tr>';
  }

  form.onsubmit = (e) => { e.preventDefault(); load(); };
  await load();
}
