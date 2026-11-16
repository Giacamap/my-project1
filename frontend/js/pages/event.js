// Chi tiết 1 lần dừng máy: sửa lý do/ghi chú + đính kèm ảnh, video, PDF.
//
// Upload file gồm 2 bước:
//   1) Đưa file vào Storage bucket 'downtime-files'
//   2) INSERT 1 dòng metadata vào bảng downtime_attachments
import {
  sb, esc, unwrap, toast, fmtDateTime, fmtMinutes, loadReasons, reasonOptions, BUCKET,
} from '../lib.js';

export async function renderEvent(app, [idParam]) {
  const id = Number(idParam);
  const [ev, reasons] = await Promise.all([
    sb.from('v_downtime_events').select('*').eq('id', id).maybeSingle().then(unwrap),
    loadReasons(),
  ]);
  if (!ev) {
    app.innerHTML = `<div class="panel"><h1>Không tìm thấy sự kiện #${id}</h1><a href="#/history">← Lịch sử</a></div>`;
    return;
  }

  app.innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/history" class="muted">← Lịch sử</a>
        <h1>Downtime #${ev.id} · <span class="mono">${esc(ev.machine_code)}</span></h1>
        <div class="muted">${esc(ev.machine_name)} · ${esc(ev.line_code)}</div>
      </div>
      ${ev.is_open ? '<span class="badge" style="color:#ff8a8d">● Đang dừng</span>' : '<span class="badge">Đã đóng</span>'}
    </div>

    <div class="grid-2">
      <div class="panel">
        <dl class="kv">
          <dt>Bắt đầu</dt><dd>${fmtDateTime(ev.started_at)}</dd>
          <dt>Kết thúc</dt><dd>${fmtDateTime(ev.ended_at)}</dd>
          <dt>Thời lượng</dt><dd>${fmtMinutes(ev.duration_min)}</dd>
          <dt>Ca</dt><dd>${esc(ev.shift_code ?? '—')}</dd>
          <dt>Nhóm</dt><dd>${esc(ev.category_name ?? '—')} ${ev.category_kind ? `<span class="badge">${esc(ev.category_kind)}</span>` : ''}</dd>
          <dt>Người báo</dt><dd>${esc(ev.reported_by_name ?? '—')}</dd>
          <dt>Người đóng</dt><dd>${esc(ev.closed_by_name ?? '—')}</dd>
        </dl>
      </div>

      <form class="panel" id="edit">
        <div class="field">
          <label>Lý do</label>
          <select name="reason_id"><option value="">— Chưa rõ —</option>${reasonOptions(reasons, ev.reason_id)}</select>
        </div>
        <div class="field"><label>Ghi chú</label><textarea name="note" rows="4">${esc(ev.note ?? '')}</textarea></div>
        <button class="btn primary">Lưu</button>
      </form>
    </div>

    <h2>File đính kèm</h2>
    <div class="panel">
      <div class="row" style="margin-bottom:16px">
        <div class="field"><input type="file" id="file" accept="image/*,video/*,application/pdf" multiple></div>
        <button class="btn" id="upload">Tải lên</button>
      </div>
      <div class="attachments" id="files"><span class="muted">Đang tải…</span></div>
    </div>`;

  // --- Sửa lý do / ghi chú (UPDATE thường, RLS quyết định ai được sửa) ---
  app.querySelector('#edit').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      const updated = unwrap(await sb.from('downtime_events')
        .update({
          reason_id: f.get('reason_id') ? Number(f.get('reason_id')) : null,
          note: f.get('note') || null,
        })
        .eq('id', id)
        .select('id'));
      // RLS chặn UPDATE không báo lỗi: chỉ trả về 0 dòng.
      if (!updated.length) throw new Error('Bạn không có quyền sửa sự kiện này');
      toast('Đã lưu');
    } catch (err) { toast(err.message, true); }
  };

  // --- File đính kèm ---
  const filesEl = app.querySelector('#files');

  async function loadFiles() {
    const files = unwrap(await sb.from('downtime_attachments')
      .select('*').eq('event_id', id).order('created_at'));
    if (!files.length) { filesEl.innerHTML = '<span class="muted">Chưa có file.</span>'; return; }

    // Bucket private → cần signed URL (link tạm thời, hết hạn sau 1 giờ).
    const { data: signed } = await sb.storage.from(BUCKET)
      .createSignedUrls(files.map((f) => f.storage_path), 3600);
    const urlOf = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

    filesEl.innerHTML = files.map((f) => {
      const url = urlOf.get(f.storage_path) ?? '#';
      const preview = f.mime_type?.startsWith('image/')
        ? `<img src="${esc(url)}" alt="${esc(f.file_name)}" loading="lazy">`
        : `<div class="file-icon">${f.mime_type?.startsWith('video/') ? 'VIDEO' : 'PDF'}</div>`;
      return `<a href="${esc(url)}" target="_blank" rel="noopener">${preview}<div class="fname">${esc(f.file_name)}</div></a>`;
    }).join('');
  }

  app.querySelector('#upload').onclick = async (e) => {
    const input = app.querySelector('#file');
    if (!input.files.length) return toast('Chọn file trước', true);
    e.target.disabled = true;
    try {
      for (const file of input.files) {
        const safeName = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_');
        const path = `${id}/${Date.now()}-${safeName}`;
        unwrap(await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type }));
        unwrap(await sb.from('downtime_attachments').insert({
          event_id: id,
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        }));
      }
      input.value = '';
      toast('Đã tải lên');
      await loadFiles();
    } catch (err) {
      toast(err.message, true);
    } finally {
      e.target.disabled = false;
    }
  };

  await loadFiles();
}
