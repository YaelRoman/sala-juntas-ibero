/* ============================================================
   LOGIN.JS — Lógica de la pantalla de autenticación
   HU-01, HU-02, HU-03, HU-22
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Si ya hay sesión activa, redirigir
  Store.init();
  const activeUser = Auth.checkSession();
  if (activeUser) {
    _redirect(activeUser.role);
    return;
  }

  _initLoginForm();
  _initForgotPassword();
  _initPasswordToggle();
});

/* ── REDIRECCIÓN POR ROL ── */
function _redirect(role) {
  window.location.href = role === 'secretaria' ? 'dashboard.html' : 'calendar.html';
}

/* ── FORMULARIO DE LOGIN ── */
function _initLoginForm() {
  const form    = document.getElementById('login-form');
  const emailEl = document.getElementById('login-email');
  const pwdEl   = document.getElementById('login-password');
  const errEl   = document.getElementById('login-error');
  const btnEl   = document.getElementById('login-btn');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    _clearError(errEl);

    const email    = emailEl.value.trim();
    const password = pwdEl.value;

    if (!email || !password) {
      _showError(errEl, 'Por favor completa todos los campos.');
      return;
    }

    // Estado de carga
    btnEl.disabled = true;
    btnEl.classList.add('btn-loading');
    btnEl.textContent = 'Verificando...';

    try {
      const result = await Auth.login(email, password);

      btnEl.disabled = false;
      btnEl.classList.remove('btn-loading');
      btnEl.textContent = 'Iniciar Sesión';

      if (result.success) {
        btnEl.textContent = '¡Bienvenido!';
        btnEl.style.background = 'var(--color-success)';
        setTimeout(() => _redirect(result.role), 600);
      } else {
        _showError(errEl, 'Credenciales inválidas. Verifica tu correo y contraseña.');
        emailEl.classList.add('is-error');
        pwdEl.classList.add('is-error');
        pwdEl.value = '';
        emailEl.focus();
      }
    } catch (err) {
      btnEl.disabled = false;
      btnEl.classList.remove('btn-loading');
      btnEl.textContent = 'Iniciar Sesión';
      _showError(errEl, 'Error de conexión. Intenta nuevamente.');
      emailEl.classList.add('is-error');
      pwdEl.classList.add('is-error');
    }
  });

  // Limpiar estado de error al escribir
  [emailEl, pwdEl].forEach(el => {
    el.addEventListener('input', () => {
      el.classList.remove('is-error');
      _clearError(errEl);
    });
  });
}

/* ── SECCIÓN OLVIDÉ CONTRASEÑA ── */
function _initForgotPassword() {
  const forgotLink    = document.getElementById('forgot-link');
  const backLink      = document.getElementById('forgot-back');
  const loginSection  = document.getElementById('login-section');
  const forgotSection = document.getElementById('forgot-section');
  const forgotForm    = document.getElementById('forgot-form');
  const forgotEmail   = document.getElementById('forgot-email');
  const forgotSuccess = document.getElementById('forgot-success');

  if (!forgotLink) return;

  forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    loginSection.classList.add('hidden');
    forgotSection.classList.remove('hidden');
    forgotEmail && forgotEmail.focus();
  });

  backLink && backLink.addEventListener('click', () => {
    forgotSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    // Reset estado
    forgotForm && (forgotForm.style.display = '');
    forgotSuccess && forgotSuccess.classList.add('hidden');
  });

  forgotForm && forgotForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = forgotEmail.value.trim();
    if (!email) return;

    try {
      await Auth.requestPasswordReset(email);
    } catch (err) {
      console.error('Password reset error:', err);
    }

    // Mostrar mensaje genérico siempre
    forgotForm.style.display = 'none';
    forgotSuccess && forgotSuccess.classList.remove('hidden');
  });
}

/* ── TOGGLE MOSTRAR/OCULTAR CONTRASEÑA ── */
function _initPasswordToggle() {
  const toggle = document.getElementById('pw-toggle');
  const pwdEl  = document.getElementById('login-password');
  if (!toggle || !pwdEl) return;

  toggle.addEventListener('click', () => {
    const isText = pwdEl.type === 'text';
    pwdEl.type = isText ? 'password' : 'text';
    toggle.setAttribute('aria-label', isText ? 'Mostrar contraseña' : 'Ocultar contraseña');
    toggle.innerHTML = isText ? _eyeIcon() : _eyeOffIcon();
  });
}

/* ── HELPERS ── */
function _showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

function _clearError(el) {
  if (!el) return;
  el.textContent = '';
  el.classList.add('hidden');
}

function _eyeIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>`;
}

function _eyeOffIcon() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>`;
}
