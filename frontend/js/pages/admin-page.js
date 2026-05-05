/* ============================================================
   ADMIN-PAGE.JS — Administración: Usuarios, Calendario, Notificaciones
   HU-05 (festivos/cierres), HU-21 (usuarios), HU-23-25 (notif log)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  Store.init();
  const user = Auth.requireRole('secretaria');
  if (!user) return;

  const isSuperAdmin = !!user.isAdmin;

  // Load fresh data from API
  try {
    const toLoad = isSuperAdmin
      ? [API.getUsers(), API.getHolidays()]
      : [Promise.resolve([]), API.getHolidays()];
    const [users, holidays] = await Promise.all(toLoad);
    Store.setState({ users, holidays });
  } catch (err) {
    console.error('Error loading admin data:', err);
    Toast.show('Error cargando datos', 'error');
  }

  Auth.startInactivityWatcher();

  /* ── Sidebar & topbar ──────────────────────────────────── */
  const _navIdForHash = (hash) => {
    if (hash === '#usuarios')       return 'admin-users';
    if (hash === '#solicitudes')    return 'admin-requests';
    if (hash === '#calendario')     return 'admin-config';
    if (hash === '#notificaciones') return 'admin-notif';
    if (hash === '#respaldos')      return 'admin-backup';
    return isSuperAdmin ? 'admin-users' : 'admin-config';
  };

  Sidebar.init(_navIdForHash(location.hash));

  const badge = document.getElementById('topbar-role-badge');
  if (badge) {
    badge.textContent = isSuperAdmin ? 'Super Admin' : 'Secretaria';
    badge.className   = `badge ${isSuperAdmin ? 'badge-warning' : 'badge-primary'} topbar__badge-role`;
  }

  /* ════════════════════════════════════════════════════════
     TABS
  ════════════════════════════════════════════════════════ */

  const TABS = [
    ...(isSuperAdmin ? [
      { id: 'tab-users',     section: 'section-users',     hash: '#usuarios',       label: 'Usuarios',    breadcrumb: 'Usuarios'          },
      { id: 'tab-requests',  section: 'section-requests',  hash: '#solicitudes',    label: 'Solicitudes', breadcrumb: 'Solicitudes de cambio' },
    ] : []),
    { id: 'tab-calendar', section: 'section-calendar', hash: '#calendario',     label: 'Calendario',     breadcrumb: 'Calendario Maestro' },
    { id: 'tab-notif',    section: 'section-notif',    hash: '#notificaciones', label: 'Notificaciones', breadcrumb: 'Notificaciones'     },
    { id: 'tab-backup',   section: 'section-backup',   hash: '#respaldos',      label: 'Respaldos',      breadcrumb: 'Respaldos'          },
  ];

  // Section state — declared here (before _activateTab is called) to avoid TDZ errors.
  // Function declarations below are hoisted and callable immediately, but they reference
  // these let variables, which are NOT hoisted. Declaring them first prevents the ReferenceError.
  let _usersInitialized  = false;
  let _calInitialized    = false;
  let _selectedDate      = null;
  let _calYear           = new Date().getFullYear();
  let _calMonth          = new Date().getMonth();
  let _backupInitialized = false;

  function _activateTab(tabId, pushState = true) {
    const tab = TABS.find(t => t.id === tabId) ?? TABS[0];

    TABS.forEach(t => {
      const btn = document.getElementById(t.id);
      const sec = document.getElementById(t.section);
      const isActive = t.id === tab.id;
      btn?.classList.toggle('is-active', isActive);
      btn?.setAttribute('aria-selected', String(isActive));
      sec?.classList.toggle('hidden', !isActive);
    });

    // Update breadcrumb + title
    const titleEl = document.getElementById('admin-page-title');
    const breadEl = document.getElementById('admin-breadcrumb');
    if (titleEl) titleEl.textContent = tab.label;
    if (breadEl) breadEl.textContent  = tab.breadcrumb;

    if (pushState) history.replaceState(null, '', tab.hash);

    // Lazy-init section content
    if (tab.id === 'tab-users')     _initUsersSection();
    if (tab.id === 'tab-requests')  _initRequestsSection();
    if (tab.id === 'tab-calendar')  _initCalendarSection();
    if (tab.id === 'tab-notif')     _renderNotifLog();
    if (tab.id === 'tab-backup')    _initBackupSection();
  }

  // Wire tab buttons
  TABS.forEach(t => {
    document.getElementById(t.id)?.addEventListener('click', () => _activateTab(t.id));
  });

  // Determine initial tab from hash; fall back to first available tab
  const _initialTab = TABS.find(t => t.hash === location.hash)?.id ?? TABS[0]?.id ?? 'tab-calendar';
  _activateTab(_initialTab, false);

  // Back/forward button support
  window.addEventListener('hashchange', () => {
    const tab = TABS.find(t => t.hash === location.hash);
    if (tab) _activateTab(tab.id, false);
  });

  // Sidebar link interception — prevents browser navigation and calls _activateTab
  // directly, bypassing the hashchange dependency entirely. This is necessary because
  // replaceState (used by in-page tab clicks) updates the URL without firing hashchange,
  // so a sidebar link pointing to the same hash would be a no-op for the browser.
  document.querySelectorAll('.nav-item[href^="admin.html"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const rawHref = a.getAttribute('href');
      const hash    = rawHref.includes('#') ? rawHref.slice(rawHref.indexOf('#')) : '';
      const tab     = TABS.find(t => t.hash === hash) ?? TABS[0];

      history.replaceState(null, '', hash);
      _activateTab(tab.id, false);

      // Sync sidebar highlight
      document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el === a);
        if (el === a) el.setAttribute('aria-current', 'page');
        else          el.removeAttribute('aria-current');
      });
    });
  });

  /* ════════════════════════════════════════════════════════
     SECTION: USERS  (HU-21)
  ════════════════════════════════════════════════════════ */

  function _initUsersSection() {
    if (_usersInitialized) { _renderUsersGrid(); return; }
    _usersInitialized = true;

    document.getElementById('btn-add-user')?.addEventListener('click', () => _openUserModal(null));
    document.getElementById('users-search')?.addEventListener('input', _renderUsersGrid);

    _renderUsersGrid();
  }

  function _renderUsersGrid(query) {
    const gridEl = document.getElementById('users-grid');
    if (!gridEl) return;

    const q = Utils.normalize(
      (typeof query === 'string' ? query : document.getElementById('users-search')?.value) ?? ''
    );
    const self = Store.getUser();

    let users = Users.getAll();
    if (q) {
      users = users.filter(u =>
        Utils.normalize(u.name).includes(q) || Utils.normalize(u.email).includes(q)
      );
    }

    if (!users.length) {
      gridEl.innerHTML = `<div style="grid-column:1/-1;color:var(--color-secondary-light);font-size:var(--font-size-sm);padding:var(--space-6);">No se encontraron usuarios.</div>`;
      return;
    }

    gridEl.innerHTML = users.map(u => _buildUserCard(u, self?.id)).join('');

    // Wire card buttons
    gridEl.querySelectorAll('[data-user-edit]').forEach(btn => {
      btn.addEventListener('click', () => _openUserModal(btn.dataset.userEdit));
    });
    gridEl.querySelectorAll('[data-user-toggle]').forEach(btn => {
      btn.addEventListener('click', () => _toggleUserActive(btn.dataset.userToggle));
    });
  }

  function _buildUserCard(u, selfId) {
    const isSelf    = u.id === selfId;
    const initial   = u.name.charAt(0).toUpperCase();
    const roleLabel = u.role === 'secretaria' ? 'Secretaria' : 'Académico';
    const roleBadge = u.role === 'secretaria'
      ? `<span class="badge badge-primary" style="font-size:10px;">${roleLabel}</span>`
      : `<span class="badge badge-info"    style="font-size:10px;">${roleLabel}</span>`;
    const statusBadge = u.active
      ? `<span class="badge badge-success" style="font-size:10px;">Activo</span>`
      : `<span class="badge badge-neutral" style="font-size:10px;">Inactivo</span>`;

    const lastLogin = u.lastLogin
      ? Utils.formatDateShort(u.lastLogin.slice(0, 10))
      : 'Sin acceso';

    const toggleLabel = u.active ? 'Desactivar' : 'Activar';
    const toggleClass = u.active ? 'btn-danger' : 'btn-success';

    return `
      <div class="user-card${!u.active ? ' is-inactive' : ''}">
        <div class="user-card__header">
          <div class="user-card__avatar" aria-hidden="true">${initial}</div>
          <div class="user-card__info">
            <div class="user-card__name" title="${Utils.escapeHTML(u.name)}">${Utils.escapeHTML(u.name)}</div>
            <div class="user-card__email" title="${Utils.escapeHTML(u.email)}">${Utils.escapeHTML(u.email)}</div>
          </div>
        </div>
        <div class="user-card__meta">
          ${roleBadge} ${statusBadge}
          ${u.isAdmin ? '<span class="badge badge-warning" style="font-size:10px;">Admin</span>' : ''}
        </div>
        <div class="user-card__last-login">Último acceso: ${lastLogin}</div>
        <div class="user-card__actions">
          <button class="btn btn-secondary btn-sm" data-user-edit="${u.id}"
                  aria-label="Editar ${Utils.escapeHTML(u.name)}">
            Editar
          </button>
          ${!isSelf ? `
          <button class="btn ${toggleClass} btn-sm" data-user-toggle="${u.id}"
                  aria-label="${toggleLabel} a ${Utils.escapeHTML(u.name)}">
            ${toggleLabel}
          </button>` : `<span style="font-size:var(--font-size-xs);color:var(--color-secondary-light);align-self:center;">(tú)</span>`}
        </div>
      </div>`;
  }

  function _toggleUserActive(id) {
    const u = Users.getById(id);
    if (!u) return;

    const action = u.active ? 'desactivar' : 'activar';
    Modal.confirm(
      {
        title:       `${u.active ? 'Desactivar' : 'Activar'} usuario`,
        message:     `¿${u.active ? 'Desactivar' : 'Activar'} la cuenta de <strong>${Utils.escapeHTML(u.name)}</strong>?<br>
                      ${u.active ? 'El usuario no podrá iniciar sesión.' : 'El usuario podrá volver a iniciar sesión.'}`,
        confirmText: `${u.active ? 'Desactivar' : 'Activar'}`,
        danger:      u.active,
      },
      async () => {
        const ok = u.active ? await Users.deactivate(id) : await Users.activate(id);
        if (ok) {
          Toast.show(`Usuario ${action === 'desactivar' ? 'desactivado' : 'activado'}.`, 'success');
          _renderUsersGrid();
        } else {
          Toast.show('No se pudo realizar la acción.', 'error');
        }
      }
    );
  }

  /* ── USER MODAL (create / edit) ── */
  function _openUserModal(editId) {
    const isEdit = !!editId;
    const u      = isEdit ? Users.getById(editId) : null;

    const overlay = document.createElement('div');
    overlay.className = 'user-modal-overlay';
    overlay.setAttribute('role',       'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', isEdit ? 'Editar usuario' : 'Crear usuario');

    overlay.innerHTML = `
      <div class="user-modal-dialog">
        <div class="user-modal-header">
          <h3>${isEdit ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <button class="btn btn-ghost btn-sm" id="user-modal-close" aria-label="Cerrar">✕</button>
        </div>
        <div class="user-modal-body">
          <div class="form-group">
            <label class="form-label" for="um-name">Nombre completo <span class="required" aria-hidden="true">*</span></label>
            <input type="text" id="um-name" class="form-input"
                   value="${Utils.escapeHTML(u?.name ?? '')}"
                   placeholder="Nombre completo" maxlength="200" required />
            <span class="form-error-msg hidden" id="um-err-name" role="alert"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="um-email">Correo electrónico <span class="required" aria-hidden="true">*</span></label>
            <input type="email" id="um-email" class="form-input"
                   value="${Utils.escapeHTML(u?.email ?? '')}"
                   placeholder="correo@ibero.mx" required />
            <span class="form-error-msg hidden" id="um-err-email" role="alert"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="um-role">Rol</label>
            <select id="um-role" class="form-select">
              <option value="academico"  ${u?.role === 'academico'  ? 'selected' : ''}>Académico</option>
              <option value="secretaria" ${u?.role === 'secretaria' ? 'selected' : ''}>Secretaria</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="um-password">
              Contraseña ${isEdit ? '<span class="form-hint">(dejar vacío para no cambiar)</span>' : '<span class="required" aria-hidden="true">*</span>'}
            </label>
            <input type="password" id="um-password" class="form-input"
                   placeholder="${isEdit ? 'Nueva contraseña (opcional)' : 'Mínimo 8 caracteres'}"
                   autocomplete="new-password" />
            <span class="form-error-msg hidden" id="um-err-pwd" role="alert"></span>
          </div>
        </div>
        <div class="user-modal-footer">
          <button class="btn btn-secondary" id="user-modal-cancel">Cancelar</button>
          <button class="btn btn-primary"   id="user-modal-save">
            ${isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#user-modal-close')?.addEventListener('click', close);
    overlay.querySelector('#user-modal-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    });

    overlay.querySelector('#user-modal-save')?.addEventListener('click', async () => {
      const name  = overlay.querySelector('#um-name')?.value.trim()  ?? '';
      const email = overlay.querySelector('#um-email')?.value.trim() ?? '';
      const role  = overlay.querySelector('#um-role')?.value         ?? 'academico';
      const pwd   = overlay.querySelector('#um-password')?.value     ?? '';

      // Clear errors
      ['um-err-name','um-err-email','um-err-pwd'].forEach(id => {
        const el = overlay.querySelector(`#${id}`);
        if (el) { el.textContent = ''; el.classList.add('hidden'); }
      });

      let result;
      if (isEdit) {
        const updates = { name, email, role };
        if (pwd) updates.password = pwd;
        result = await Users.update(editId, updates);
      } else {
        result = await Users.create({ name, email, role, password: pwd });
      }

      if (result.success) {
        Toast.show(isEdit ? 'Usuario actualizado.' : 'Usuario creado.', 'success');
        close();
        _renderUsersGrid();
      } else {
        const msg = Users.errorMessage(result.error);
        const fieldMap = {
          missing_fields: 'um-err-name',
          invalid_email:  'um-err-email',
          email_taken:    'um-err-email',
          weak_password:  'um-err-pwd',
          api_error:      'um-err-name',
        };
        const errId = fieldMap[result.error] ?? 'um-err-name';
        const errEl = overlay.querySelector(`#${errId}`);
        if (errEl) {
          errEl.textContent = msg;
          errEl.classList.remove('hidden');
        }
      }
    });

    // Focus first field
    overlay.querySelector('#um-name')?.focus();
  }

  /* ════════════════════════════════════════════════════════
     SECTION: CALENDAR CONFIG (HU-05)
  ════════════════════════════════════════════════════════ */

  function _initCalendarSection() {
    if (_calInitialized) return;
    _calInitialized = true;

    _renderMiniCal();

    document.getElementById('admin-cal-prev')?.addEventListener('click', () => {
      _calMonth--;
      if (_calMonth < 0) { _calMonth = 11; _calYear--; }
      _renderMiniCal();
    });

    document.getElementById('admin-cal-next')?.addEventListener('click', () => {
      _calMonth++;
      if (_calMonth > 11) { _calMonth = 0; _calYear++; }
      _renderMiniCal();
    });

    document.getElementById('add-holiday-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!_selectedDate) {
        Toast.show('Selecciona una fecha en el calendario primero.', 'warning');
        return;
      }
      const name = document.getElementById('holiday-name')?.value.trim() ?? '';
      const type = document.getElementById('holiday-type')?.value ?? 'holiday';
      if (!name) {
        Toast.show('Escribe un nombre para la fecha.', 'warning');
        document.getElementById('holiday-name')?.focus();
        return;
      }
      Holidays.add({ date: _selectedDate, name, type });
      Toast.show(`${type === 'holiday' ? 'Día festivo' : 'Cierre'} marcado: ${Utils.formatDateLong(_selectedDate)}`, 'success');
      _resetCalForm();
      _renderMiniCal();
      _renderHolidayList();
    });

    _renderHolidayList();
  }

  function _renderMiniCal() {
    const titleEl = document.getElementById('admin-cal-title');
    if (titleEl) titleEl.textContent = `${Utils.monthName(_calMonth)} ${_calYear}`;

    CalendarGrid.render({
      containerId:  'admin-mini-cal',
      year:         _calYear,
      month:        _calMonth,
      reservations: [],
      holidays:     Store.getState().holidays,
      editable:     true,
      maxPerDay:    0,
      onDayClick:   _onDateSelect,
    });
  }

  function _onDateSelect(dateStr) {
    _selectedDate = dateStr;

    const display = document.getElementById('selected-date-display');
    if (display) display.textContent = Utils.formatDateLong(dateStr);

    const btn = document.getElementById('btn-mark-date');
    if (btn) btn.disabled = false;

    const count     = Holidays.conflictCount(dateStr);
    const alertEl   = document.getElementById('conflict-warning');
    const alertText = document.getElementById('conflict-warning-text');
    if (alertEl && alertText) {
      if (count > 0) {
        alertText.textContent = `Hay ${count} reservación${count > 1 ? 'es' : ''} activa${count > 1 ? 's' : ''} en esta fecha.`;
        alertEl.classList.remove('hidden');
      } else {
        alertEl.classList.add('hidden');
      }
    }
  }

  function _resetCalForm() {
    _selectedDate = null;
    const display = document.getElementById('selected-date-display');
    if (display) display.textContent = 'Haz clic en un día del calendario';
    const btn = document.getElementById('btn-mark-date');
    if (btn) btn.disabled = true;
    const nameInput = document.getElementById('holiday-name');
    if (nameInput) nameInput.value = '';
    document.getElementById('conflict-warning')?.classList.add('hidden');
  }

  function _renderHolidayList() {
    Holidays.renderList('holiday-list', _renderHolidayList);
    const count  = Holidays.getAll().length;
    const countEl = document.getElementById('holiday-count');
    if (countEl) {
      countEl.textContent = count
        ? `${count} fecha${count > 1 ? 's' : ''} marcada${count > 1 ? 's' : ''}`
        : '';
    }
  }

  /* ════════════════════════════════════════════════════════
     SECTION: NOTIFICATIONS LOG (HU-23-25)
  ════════════════════════════════════════════════════════ */

  function _renderNotifLog() {
    const body = document.getElementById('notif-log-body');
    if (!body) return;

    const log = Notifications.getLog();

    if (!log.length) {
      body.innerHTML = '<div class="notif-empty">No hay notificaciones registradas aún.<br>Se registran automáticamente al crear o cancelar reservaciones.</div>';
      return;
    }

    body.innerHTML = log.slice(0, 50).map(entry => {
      const time = new Date(entry.sentAt).toLocaleString('es-MX', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
      });

      return `
        <div class="notif-entry">
          <div class="notif-entry__icon" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
              <polyline points="22,6 12,13 2,6"/>
            </svg>
          </div>
          <div class="notif-entry__body">
            <div class="notif-entry__subject">${Utils.escapeHTML(entry.subject)}</div>
            <div class="notif-entry__to">Para: ${Utils.escapeHTML(entry.to)}</div>
          </div>
          <span class="notif-entry__time">${time}</span>
        </div>`;
    }).join('');
  }

  document.getElementById('btn-clear-notif')?.addEventListener('click', () => {
    Modal.confirm(
      { title: 'Limpiar log', message: '¿Eliminar todo el historial de notificaciones?', confirmText: 'Limpiar', danger: true },
      () => {
        Store.setState({ notificationLog: [] });
        Store.persist();
        _renderNotifLog();
        Toast.show('Log de notificaciones limpiado.', 'success');
      }
    );
  });

  /* ════════════════════════════════════════════════════════
     SECTION: RESPALDOS (HU-18, HU-19)
  ════════════════════════════════════════════════════════ */

  function _initBackupSection() {
    // Update data counts in the UI
    _updateBackupCounts();

    if (_backupInitialized) { _renderBackupLog(); return; }
    _backupInitialized = true;

    /* ── Crear respaldo ── */
    document.getElementById('btn-create-backup')?.addEventListener('click', () => {
      const result = Backup.create();
      if (result.success) {
        Toast.show(`Respaldo descargado: ${result.filename}`, 'success');
        _renderBackupLog();
      } else {
        Toast.show('Error al crear el respaldo.', 'error');
      }
    });

    /* ── Copia rápida (autoSave) ── */
    document.getElementById('btn-auto-save')?.addEventListener('click', () => {
      const result = Backup.autoSave();
      if (result.success) {
        Toast.show('Copia rápida guardada en este navegador.', 'success');
        _renderBackupLog();
      } else {
        Toast.show('No se pudo guardar la copia rápida.', 'error');
      }
    });

    /* ── Habilitar botón de restaurar cuando se selecciona archivo ── */
    const fileInput  = document.getElementById('backup-file-input');
    const btnRestore = document.getElementById('btn-restore-backup');
    fileInput?.addEventListener('change', () => {
      if (btnRestore) btnRestore.disabled = !fileInput.files?.length;
    });

    /* ── Restaurar desde archivo ── */
    btnRestore?.addEventListener('click', () => {
      const file = fileInput?.files?.[0];
      if (!file) return;

      Modal.confirm(
        {
          title:       'Restaurar respaldo',
          message:     `¿Restaurar los datos desde <strong>${Utils.escapeHTML(file.name)}</strong>?<br>
                        <span style="color:var(--color-warning);">Esta acción reemplazará TODOS los datos actuales.</span>`,
          confirmText: 'Sí, restaurar',
          danger:      true,
        },
        async () => {
          const result = await Backup.restore(file);
          if (result.success) {
            const { reservations, users, holidays } = result.restored;
            Toast.show(
              `Datos restaurados: ${reservations} reservaciones, ${users} usuarios, ${holidays} festivos.`,
              'success'
            );
            _updateBackupCounts();
            _renderBackupLog();
            if (fileInput) fileInput.value = '';
            if (btnRestore) btnRestore.disabled = true;
          } else {
            Toast.show(Backup.errorMessage(result.error), 'error');
          }
        }
      );
    });

    /* ── Restaurar copia rápida ── */
    document.getElementById('btn-restore-auto')?.addEventListener('click', () => {
      Modal.confirm(
        {
          title:       'Restaurar copia rápida',
          message:     '¿Restaurar el último punto de restauración guardado en este navegador?<br>' +
                       '<span style="color:var(--color-warning);">Esto reemplazará los datos actuales.</span>',
          confirmText: 'Restaurar',
          danger:      true,
        },
        () => {
          const result = Backup.restoreAuto();
          if (result.success) {
            const when = result.createdAt
              ? `Punto guardado: ${new Date(result.createdAt).toLocaleString('es-MX')}`
              : '';
            Toast.show(`Copia rápida restaurada. ${when}`, 'success');
            _updateBackupCounts();
            _renderBackupLog();
          } else {
            Toast.show(Backup.errorMessage(result.error), 'error');
          }
        }
      );
    });

    /* ── Limpiar log ── */
    document.getElementById('btn-clear-backup-log')?.addEventListener('click', () => {
      Modal.confirm(
        { title: 'Limpiar historial', message: '¿Eliminar el historial de respaldos?', confirmText: 'Limpiar', danger: true },
        () => {
          Backup.clearLog();
          _renderBackupLog();
          Toast.show('Historial de respaldos limpiado.', 'success');
        }
      );
    });

    _renderBackupLog();
  }

  function _updateBackupCounts() {
    const state = Store.getState();
    const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    _set('bkp-count-reservations', state.reservations.length);
    _set('bkp-count-users',        state.users.length);
    _set('bkp-count-holidays',     state.holidays.length);
  }

  function _renderBackupLog() {
    const body = document.getElementById('backup-log-body');
    if (!body) return;

    const log = Backup.getLog();

    if (!log.length) {
      body.innerHTML = '<div class="notif-empty">No hay respaldos registrados aún.</div>';
      return;
    }

    const TYPE_LABELS = { export: 'Respaldo descargado', import: 'Restauración desde archivo', auto: 'Copia rápida' };
    const TYPE_COLORS = { export: 'var(--color-success)', import: 'var(--color-warning)', auto: 'var(--color-info)' };

    body.innerHTML = log.slice(0, 30).map(entry => {
      const time   = new Date(entry.createdAt).toLocaleString('es-MX', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      const label  = TYPE_LABELS[entry.type] ?? entry.type;
      const color  = TYPE_COLORS[entry.type] ?? 'var(--color-secondary-light)';
      const status = entry.status === 'success' ? '✓' : entry.status === 'error' ? '✗' : '↺';
      const size   = entry.sizeBytes ? Backup.formatSize(entry.sizeBytes) : '';
      const counts = entry.counts
        ? `${entry.counts.reservations} res. · ${entry.counts.users} usr. · ${entry.counts.holidays} fest.`
        : (entry.error ?? '');

      return `
        <div class="notif-entry">
          <div class="notif-entry__icon" style="background:transparent;border-color:${color};color:${color};"
               aria-hidden="true">${status}</div>
          <div class="notif-entry__body">
            <div class="notif-entry__subject">${Utils.escapeHTML(label)}</div>
            <div class="notif-entry__to">
              ${entry.filename !== '(auto)' ? Utils.escapeHTML(entry.filename) : 'Memoria local'}
              ${size ? ` · ${size}` : ''}
              ${counts ? ` · ${Utils.escapeHTML(counts)}` : ''}
            </div>
          </div>
          <span class="notif-entry__time">${time}</span>
        </div>`;
    }).join('');
  }

  /* ════════════════════════════════════════════════════════
     SECTION: MODIFICATION REQUESTS  (super-admin only)
  ════════════════════════════════════════════════════════ */

  let _requestsInitialized = false;

  function _initRequestsSection() {
    _renderRequests();
    _requestsInitialized = true;
  }

  async function _renderRequests() {
    const container = document.getElementById('requests-list');
    if (!container) return;
    container.innerHTML = '<div class="notif-empty">Cargando…</div>';

    try {
      const requests = await API.getModificationRequests();
      if (!requests.length) {
        container.innerHTML = '<div class="notif-empty">No hay solicitudes pendientes.</div>';
        return;
      }

      const TZ = 'America/Mexico_City';
      const _fmt = (iso) => new Date(iso).toLocaleString('es-MX', {
        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ
      });

      container.innerHTML = requests.map(r => `
        <div class="req-card" data-req-id="${r.id}">
          <div class="req-card__meta">
            <strong>${Utils.escapeHTML(r.requester_name)}</strong> solicita cambiar la reservación de
            <strong>${Utils.escapeHTML(r.responsible_name)}</strong> (${Utils.escapeHTML(r.area)})
          </div>
          <div class="req-card__times">
            <span class="req-card__label">Actual:</span>
            ${_fmt(r.current_start)} – ${_fmt(r.current_end)}
          </div>
          <div class="req-card__times">
            <span class="req-card__label">Solicitado:</span>
            ${_fmt(r.new_start_time)} – ${_fmt(r.new_end_time)}
          </div>
          ${r.reason ? `<div class="req-card__reason">"${Utils.escapeHTML(r.reason)}"</div>` : ''}
          <div class="req-card__actions">
            <button class="btn btn-success btn-sm req-approve" data-id="${r.id}">Aprobar</button>
            <button class="btn btn-danger btn-sm req-reject"  data-id="${r.id}">Rechazar</button>
          </div>
        </div>`).join('');

      container.querySelectorAll('.req-approve').forEach(btn => {
        btn.addEventListener('click', () => _approveRequest(btn.dataset.id));
      });
      container.querySelectorAll('.req-reject').forEach(btn => {
        btn.addEventListener('click', () => _rejectRequest(btn.dataset.id));
      });
    } catch (err) {
      console.error('Error loading requests:', err);
      container.innerHTML = '<div class="notif-empty">Error cargando solicitudes.</div>';
    }
  }

  async function _approveRequest(id) {
    try {
      await API.approveModificationRequest(id);
      Toast.show('Solicitud aprobada', 'success');
      _renderRequests();
    } catch (err) {
      Toast.show(err.message || 'Error al aprobar', 'error');
    }
  }

  async function _rejectRequest(id) {
    const reason = prompt('Motivo del rechazo (opcional):') ?? '';
    try {
      await API.rejectModificationRequest(id, reason);
      Toast.show('Solicitud rechazada', 'success');
      _renderRequests();
    } catch (err) {
      Toast.show(err.message || 'Error al rechazar', 'error');
    }
  }

});
