/* ============================================================
   AUTH.JS — Autenticación y gestión de sesión
   HU-01 (secretaria), HU-02 (académico), HU-03 (logout), HU-22 (forgot pwd)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const Auth = (() => {
  const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos

  /* ── LOGIN ── */
  const login = async (email, password) => {
    try {
      const result = await API.login(email, password);

      // Store JWT token and session
      localStorage.setItem('ibero_jwt', result.token);
      localStorage.setItem('ibero_session', JSON.stringify(result.user));
      localStorage.setItem('ibero_login_time', Date.now().toString());

      Store.setState({ currentUser: result.user });
      return { success: true, role: result.user.role };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, error: 'Credenciales inválidas' };
    }
  };

  /* ── LOGOUT ── */
  const logout = async () => {
    try {
      await API.logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
    Store.setState({ currentUser: null });
    localStorage.removeItem('ibero_jwt');
    localStorage.removeItem('ibero_session');
    localStorage.removeItem('ibero_login_time');
    window.location.href = 'index.html';
  };

  /* ── VERIFICAR SESIÓN ── */
  const checkSession = () => {
    const raw = localStorage.getItem('ibero_session');
    const loginTime = localStorage.getItem('ibero_login_time');
    const token = localStorage.getItem('ibero_jwt');

    if (!raw || !loginTime || !token) return null;

    const elapsed = Date.now() - parseInt(loginTime, 10);
    if (elapsed > SESSION_TIMEOUT) {
      logout();
      return null;
    }

    const user = JSON.parse(raw);
    localStorage.setItem('ibero_login_time', Date.now().toString());
    Store.setState({ currentUser: user });
    return user;
  };

  /* ── PROTECCIÓN DE RUTA POR ROL ── */
  const requireRole = (requiredRole) => {
    const user = checkSession();
    if (!user) {
      window.location.href = 'index.html';
      return null;
    }
    if (requiredRole && user.role !== requiredRole) {
      if (user.role === 'secretaria') {
        window.location.href = 'dashboard.html';
      } else {
        window.location.href = 'calendar.html';
      }
      return null;
    }
    return user;
  };

  /* ── PROTECCIÓN POR SUPER-ADMIN ── */
  const requireSuperAdmin = () => {
    const user = checkSession();
    if (!user) {
      window.location.href = 'index.html';
      return null;
    }
    if (!user.isAdmin) {
      window.location.href = user.role === 'secretaria' ? 'dashboard.html' : 'calendar.html';
      return null;
    }
    return user;
  };

  /* ── PROTECCIÓN GENERAL (cualquier sesión válida) ── */
  const requireAuth = () => {
    const user = checkSession();
    if (!user) {
      window.location.href = 'index.html';
      return null;
    }
    return user;
  };

  /* ── OLVIDÉ CONTRASEÑA ── */
  const requestPasswordReset = async (email) => {
    try {
      await API.forgotPassword(email);
      return { success: true, message: 'Si el correo existe, recibirás un enlace de recuperación.' };
    } catch (err) {
      console.error('Password reset request error:', err);
      return { success: true, message: 'Si el correo existe, recibirás un enlace de recuperación.' };
    }
  };

  /* ── TIMEOUT AUTOMÁTICO ── */
  let _inactivityTimer = null;

  const resetInactivityTimer = () => {
    clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(() => {
      if (checkSession()) {
        Toast && Toast.show('Sesión expirada por inactividad', 'warning');
        setTimeout(logout, 1500);
      }
    }, SESSION_TIMEOUT);
  };

  const startInactivityWatcher = () => {
    ['mousemove','keydown','click','scroll','touchstart'].forEach(evt => {
      document.addEventListener(evt, resetInactivityTimer, { passive: true });
    });
    resetInactivityTimer();
  };

  return {
    login,
    logout,
    checkSession,
    requireRole,
    requireAuth,
    requireSuperAdmin,
    requestPasswordReset,
    startInactivityWatcher
  };
})();
