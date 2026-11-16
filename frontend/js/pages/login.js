import { sb, toast } from '../lib.js';

export function renderLogin(app) {
  app.innerHTML = `
    <div class="panel login">
      <div class="brand"><span class="brand-mark"></span><span>Factory<b>Kits</b></span></div>
      <p class="muted" style="text-align:center;margin-top:0">Mini-MES · Ghi nhận downtime</p>
      <form id="login-form">
        <div class="field" id="name-field" hidden>
          <label for="full_name">Họ tên</label>
          <input id="full_name" name="full_name" autocomplete="name">
        </div>
        <div class="field">
          <label for="email">Email</label>
          <input id="email" name="email" type="email" required autocomplete="email">
        </div>
        <div class="field">
          <label for="password">Mật khẩu</label>
          <input id="password" name="password" type="password" required minlength="6" autocomplete="current-password">
        </div>
        <button class="btn primary" style="width:100%" id="submit">Đăng nhập</button>
      </form>
      <p class="muted" style="text-align:center;font-size:.9rem">
        <a href="#" id="toggle">Chưa có tài khoản? Đăng ký</a>
      </p>
    </div>`;

  let signUp = false;
  const form = app.querySelector('#login-form');
  const submit = app.querySelector('#submit');

  app.querySelector('#toggle').onclick = (ev) => {
    ev.preventDefault();
    signUp = !signUp;
    app.querySelector('#name-field').hidden = !signUp;
    submit.textContent = signUp ? 'Đăng ký' : 'Đăng nhập';
    ev.target.textContent = signUp ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Đăng ký';
  };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const email = f.get('email');
    const password = f.get('password');
    submit.disabled = true;
    try {
      if (signUp) {
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: {
            data: { full_name: f.get('full_name') || null },  // → raw_user_meta_data
            emailRedirectTo: location.origin + location.pathname,
          },
        });
        if (error) throw error;
        if (!data.session) toast('Đã gửi email xác nhận. Mở email rồi đăng nhập lại.');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      submit.disabled = false;
    }
  };
}
