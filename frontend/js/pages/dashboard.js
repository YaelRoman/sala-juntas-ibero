/* ============================================================
   DASHBOARD.JS — Lógica del dashboard principal (Secretaria)
   HU-01, HU-04, HU-07
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Proteger ruta
  Store.init();
  const user = Auth.requireAuth();
  if (!user) return;

  // 2. Sidebar compartido
  Sidebar.init('dashboard');

  // 3. Badge de rol en topbar
  const badgeEl = document.getElementById('topbar-role-badge');
  if (badgeEl) {
    badgeEl.textContent = user.role === 'secretaria' ? 'Secretaria' : 'Académico';
    badgeEl.className   = `badge ${user.role === 'secretaria' ? 'badge-primary' : 'badge-info'} topbar__badge-role`;
  }

  // 4. Iniciar watcher de inactividad
  Auth.startInactivityWatcher();

  // 5. Load data from API
  try {
    const [reservations, holidays] = await Promise.all([
      API.getReservations(),
      API.getHolidays()
    ]);
    Store.setState({ reservations, holidays });
  } catch (err) {
    console.error('Error loading data:', err);
    Toast && Toast.show('Error cargando datos', 'error');
  }

  // 6. Renderizar estadísticas resumen
  _renderStats();

  // 7. Renderizar calendario
  _initCalendar();

  // 8. Renderizar próximas reservaciones
  _renderUpcoming();

  // 9. Event listeners propios de la página
  _initEventListeners();
});

/* ── ESTADÍSTICAS ── */
function _renderStats() {
  const state    = Store.getState();
  const today    = Utils.today();
  const now      = new Date();

  // Mes actual
  const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const thisMonthEnd   = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(Utils.daysInMonth(now.getFullYear(), now.getMonth())).padStart(2,'0')}`;

  const thisMonth   = state.reservations.filter(r =>
    r.date >= thisMonthStart && r.date <= thisMonthEnd && r.status !== 'cancelled'
  );

  // Próximos 7 días
  const in7Days = new Date(); in7Days.setDate(in7Days.getDate() + 7);
  const in7Str  = Utils.dateToISO(in7Days);
  const next7   = state.reservations.filter(r =>
    r.date >= today && r.date <= in7Str && r.status === 'active'
  );

  // Hoy
  const todayRes = state.reservations.filter(r =>
    r.date === today && r.status === 'active'
  );

  // Recurrentes activas
  const recurring = state.reservations.filter(r =>
    r.isRecurring && r.status === 'active' && r.date >= today
  );

  const _set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  _set('stat-total',     thisMonth.length);
  _set('stat-active',    next7.length);
  _set('stat-today',     todayRes.length);
  _set('stat-recurring', recurring.length);
}

/* ── CALENDARIO ── */
function _initCalendar() {
  const user = Store.getUser();
  const isSecretary = user?.role === 'secretaria';

  Calendar.init({
    containerId:        'calendar-body',
    titleId:            'cal-month-title',
    editable:           isSecretary,
    selectable:         isSecretary,
    onDayClick:         _onDayClick,
    onReservationClick: _onReservationClick,
    onSelectionChange:  _onSelectionChange,
    onCommitSelection:  _openReservationModalFromSelection,
    onBlockDrop:        isSecretary ? _onBlockDrop   : null,
    onBlockResize:      isSecretary ? _onBlockResize : null,
  });

  if (isSecretary) {
    _initContextMenus();
  }
}

/* ── CLICK EN DÍA EN VISTA MENSUAL ── */
/* Cambia a la vista semanal del día seleccionado y resalta la columna. */
function _onDayClick(dateStr) {
  if (!dateStr) return;
  Store.setState({ selectedDate: dateStr });
  Calendar.setHighlightDate(dateStr);
  _setViewActive('week');
  Calendar.renderWeek(new Date(`${dateStr}T00:00:00`), dateStr);
}

/* ── CLICK EN RESERVACIÓN ── */
function _onReservationClick(id, event) {
  const state = Store.getState();
  const r = state.reservations.find(res => res.id === id);
  if (!r) return;

  _closePopup(); // Cerrar popup previo

  const rect  = event.currentTarget.getBoundingClientRect();
  const user  = Store.getUser();
  const isSecretary = user?.role === 'secretaria';

  const popup = document.createElement('div');
  popup.id = 'cal-popup';
  popup.className = 'cal-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-label', 'Detalle de reservación');

  const cancelledBadge = r.status === 'cancelled'
    ? `<span class="badge badge-error" style="font-size:10px;">Cancelada</span>`
    : `<span class="badge badge-success" style="font-size:10px;">Activa</span>`;

  const actions = isSecretary && r.status === 'active' ? `
    <div class="cal-popup__actions">
      <button class="btn btn-secondary btn-sm" id="popup-edit" data-id="${r.id}">Editar</button>
      <button class="btn btn-danger btn-sm"    id="popup-cancel" data-id="${r.id}">Cancelar</button>
    </div>` : '';

  popup.innerHTML = `
    <div class="cal-popup__header">
      <span class="cal-popup__title">${Utils.escapeHTML(r.responsible)}</span>
      <button class="cal-popup__close" aria-label="Cerrar detalle" id="popup-close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="cal-popup__body">
      <div class="cal-popup__row">
        <svg class="cal-popup__icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
        <div>
          <div class="cal-popup__label">${Utils.formatDateLong(r.date)}</div>
          <div class="cal-popup__value">${r.startTime} – ${r.endTime}</div>
        </div>
      </div>
      <div class="cal-popup__row">
        <svg class="cal-popup__icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
        <div>
          <div class="cal-popup__label">${Utils.escapeHTML(r.responsible)}</div>
          <div class="cal-popup__value">${Utils.escapeHTML(r.area)}</div>
        </div>
      </div>
      ${r.observations ? `
      <div class="cal-popup__row">
        <svg class="cal-popup__icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <div class="cal-popup__value">${Utils.escapeHTML(r.observations)}</div>
      </div>` : ''}
      <div class="cal-popup__row">${cancelledBadge}</div>
    </div>
    ${actions}
  `;

  document.body.appendChild(popup);

  // Posicionar popup
  const pw = 280;
  let left = rect.right + 8;
  let top  = rect.top;
  if (left + pw > window.innerWidth - 8) left = rect.left - pw - 8;
  if (top + popup.offsetHeight > window.innerHeight - 8)
    top = window.innerHeight - popup.offsetHeight - 8;
  if (top < 8) top = 8;

  popup.style.left = `${Math.max(8, left)}px`;
  popup.style.top  = `${top}px`;

  // Listeners
  document.getElementById('popup-close')?.addEventListener('click', _closePopup);

  const editBtn = document.getElementById('popup-edit');
  editBtn?.addEventListener('click', () => {
    _closePopup();
    window.location.href = `reservacion.html?edit=${r.id}`;
  });

  const cancelBtn = document.getElementById('popup-cancel');
  cancelBtn?.addEventListener('click', () => {
    _closePopup();
    _cancelReservation(r.id);
  });

  // Cerrar con Escape o click fuera
  const _onKeydown = (e) => {
    if (e.key === 'Escape') _closePopup();
  };
  const _onOutsideClick = (e) => {
    if (!popup.contains(e.target)) _closePopup();
  };
  document.addEventListener('keydown', _onKeydown);
  setTimeout(() => document.addEventListener('click', _onOutsideClick), 50);

  popup._cleanup = () => {
    document.removeEventListener('keydown', _onKeydown);
    document.removeEventListener('click', _onOutsideClick);
  };

  // Focus al popup
  popup.setAttribute('tabindex', '-1');
  popup.focus();
}

function _closePopup() {
  const p = document.getElementById('cal-popup');
  if (p) {
    p._cleanup?.();
    p.remove();
  }
}

/* ── CANCELAR RESERVACIÓN ── */
function _cancelReservation(id) {
  const r = Reservations.getById(id);
  if (!r) return;

  const _refresh = () => {
    _renderStats();
    Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
    _renderUpcoming();
  };

  if (r.isRecurring && r.recurringGroupId) {
    Modal.choice(
      {
        title:       'Cancelar reservación recurrente',
        message:     `<strong>${Utils.escapeHTML(r.responsible)}</strong> — ${Utils.formatDateLong(r.date)}<br>
                      Esta reservación pertenece a una serie recurrente.`,
        option1Text: 'Solo esta instancia',
        option2Text: 'Toda la serie',
      },
      () => {
        Reservations.cancel(id);
        Toast.show('Instancia cancelada.', 'success');
        _refresh();
      },
      () => {
        const count = Recurring.cancelSeries(r.recurringGroupId);
        Toast.show(`Serie cancelada: ${count} instancia${count !== 1 ? 's' : ''}.`, 'success');
        _refresh();
      }
    );
  } else {
    Modal.confirm(
      {
        title:       'Cancelar reservación',
        message:     `¿Cancelar la reservación de <strong>${Utils.escapeHTML(r.responsible)}</strong><br>
                      el ${Utils.formatDateLong(r.date)}, ${r.startTime}–${r.endTime}?`,
        confirmText: 'Cancelar reservación',
        danger:      true,
      },
      () => {
        Reservations.cancel(id);
        Toast.show('Reservación cancelada.', 'success');
        _refresh();
      }
    );
  }
}

/* ── PRÓXIMAS RESERVACIONES ── */
function _renderUpcoming() {
  const listEl = document.getElementById('upcoming-list');
  if (!listEl) return;

  const today = Utils.today();
  const upcoming = Store.getReservations({ dateFrom: today, status: 'active' })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .slice(0, 8);

  if (!upcoming.length) {
    listEl.innerHTML = '<div class="upcoming-empty">No hay reservaciones próximas</div>';
    return;
  }

  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  listEl.innerHTML = upcoming.map(r => {
    const [y, m, d] = r.date.split('-');
    return `
      <div class="upcoming-item" data-id="${r.id}" role="button" tabindex="0"
           aria-label="${r.responsible} el ${r.date}">
        <div class="upcoming-item__date" aria-hidden="true">
          <span class="upcoming-item__day">${parseInt(d,10)}</span>
          <span class="upcoming-item__month">${months[parseInt(m,10)-1]}</span>
        </div>
        <div class="upcoming-item__info">
          <div class="upcoming-item__title">${Utils.escapeHTML(r.responsible)}</div>
          <div class="upcoming-item__meta">
            ${r.startTime} – ${r.endTime} &nbsp;·&nbsp; ${Utils.escapeHTML(Utils.truncate(r.area, 22))}
          </div>
        </div>
      </div>`;
  }).join('');

  // Clicks
  listEl.querySelectorAll('.upcoming-item').forEach(item => {
    item.addEventListener('click', () =>
      _onReservationClick(item.dataset.id, { currentTarget: item, stopPropagation: ()=>{} })
    );
  });
}

/* ── EVENT LISTENERS GENERALES ── */
function _initEventListeners() {
  // Navegación — delegada al módulo Calendar (HU-07)
  document.getElementById('cal-prev')?.addEventListener('click',  () => Calendar.navigateTo('prev'));
  document.getElementById('cal-next')?.addEventListener('click',  () => Calendar.navigateTo('next'));
  document.getElementById('cal-today')?.addEventListener('click', () => Calendar.navigateTo('today'));

  // Toggle vista mes/semana
  document.getElementById('view-month')?.addEventListener('click', () => {
    _setViewActive('month');
    Calendar.setHighlightDate(null);
    CalendarWeek.clearSelection();
    Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
    _hideSelectionBar();
  });
  document.getElementById('view-week')?.addEventListener('click', () => {
    _setViewActive('week');
    CalendarWeek.clearSelection();
    Calendar.renderWeek(new Date());
  });

  // Selección semanal — botones de la barra
  document.getElementById('cal-selection-clear')?.addEventListener('click', () => {
    CalendarWeek.clearSelection();
  });
  document.getElementById('cal-selection-book')?.addEventListener('click', () => {
    _openReservationModalFromSelection(CalendarWeek.getSelection());
  });

  // Nueva reservación — topbar y FAB (sin selección previa)
  ['topbar-nueva-reserva', 'fab-nueva'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.href = 'reservacion.html';
    });
  });
}

/* ════════════════════════════════════════
   SELECCIÓN MULTI-HORA + MODAL DE RESERVACIÓN
   ════════════════════════════════════════ */
function _onSelectionChange(selected) {
  const bar    = document.getElementById('cal-selection-bar');
  const countEl = document.getElementById('cal-selection-count');
  const inWeek = Calendar.getCurrentView() === 'week';
  if (!bar) return;

  if (!inWeek || !selected.length) {
    _hideSelectionBar();
    return;
  }
  bar.classList.remove('hidden');
  const totalMin  = selected.length * 30;
  const hPart     = Math.floor(totalMin / 60);
  const mPart     = totalMin % 60;
  const timeLabel = hPart > 0 && mPart > 0 ? `${hPart}h ${mPart}min`
                  : hPart > 0              ? `${hPart}h`
                  :                          `${mPart}min`;
  countEl.textContent = `${selected.length} bloque${selected.length !== 1 ? 's' : ''} · ${timeLabel}`;
}

function _hideSelectionBar() {
  document.getElementById('cal-selection-bar')?.classList.add('hidden');
}

function _openReservationModalFromSelection() {
  const intervals = CalendarWeek.getIntervals();
  if (!intervals.length) {
    Toast?.show('Selecciona al menos una hora antes de reservar.', 'warning');
    return;
  }
  ReservationModal.open({
    intervals,
    onSaved: async () => {
      // Refrescar datos del store y re-renderizar
      try {
        const reservations = await API.getReservations();
        Store.setState({ reservations });
      } catch (err) {
        console.error('Refresh after save failed:', err);
      }
      CalendarWeek.clearSelection();
      _renderStats();
      _renderUpcoming();
      // Re-render la vista activa
      if (Calendar.getCurrentView() === 'week') {
        Calendar.renderWeek(new Date(`${intervals[0].date}T00:00:00`), Calendar.getHighlightDate());
      } else {
        Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
      }
    },
  });
}

/* ════════════════════════════════════════
   MENÚS CONTEXTUALES (click derecho)
   Vista mensual  → popover de festivo/cierre
   Vista semanal  → menú con 2 opciones
   ════════════════════════════════════════ */
function _initContextMenus() {
  const body = document.getElementById('calendar-body');
  if (!body) return;

  body.addEventListener('contextmenu', (e) => {
    const view = Calendar.getCurrentView();

    if (view === 'month') {
      const cell = e.target.closest('.cal-day:not(.is-other-month)');
      if (!cell) return;

      let date = cell.dataset.date;
      if (!date) {
        const num = parseInt(cell.querySelector('.cal-day__number')?.textContent ?? '', 10);
        if (!num) return;
        const y = Calendar.getCurrentYear();
        const m = Calendar.getCurrentMonth();
        date = `${y}-${String(m+1).padStart(2,'0')}-${String(num).padStart(2,'0')}`;
      }
      e.preventDefault();
      _openHolidayPopover(cell, date);
      return;
    }

    if (view === 'week') {
      const col = e.target.closest('.cal-wk__day-col[data-date]');
      if (!col) return;
      const date = col.dataset.date;
      e.preventDefault();
      _openWeekContextMenu(date, e.clientX, e.clientY);
    }
  });
}

function _closeWeekContextMenu() {
  document.getElementById('wk-ctx-menu')?.remove();
}

function _openWeekContextMenu(dateStr, x, y) {
  _closeWeekContextMenu();
  document.getElementById('holiday-popover')?.remove();

  const existing = (Store.getState().holidays || []).find(h => h.date === dateStr);
  const holidayLabel = existing ? 'Quitar marca de festivo' : 'Marcar como festivo';

  const menu = document.createElement('div');
  menu.id = 'wk-ctx-menu';
  menu.className = 'wk-ctx-menu';
  menu.innerHTML = `
    <button class="wk-ctx-menu__item" id="wk-ctx-monthly">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      Ver en vista mensual
    </button>
    <button class="wk-ctx-menu__item ${existing ? 'wk-ctx-menu__item--danger' : ''}" id="wk-ctx-holiday">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${existing
          ? '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
          : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
      </svg>
      ${holidayLabel}
    </button>`;

  document.body.appendChild(menu);

  // Position at cursor, flip if overflowing
  const mw = 220, mh = 80;
  const left = x + mw > window.innerWidth  - 8 ? x - mw : x;
  const top  = y + mh > window.innerHeight - 8 ? y - mh : y;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top  = `${Math.max(8, top)}px`;

  const close = () => {
    menu.remove();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onOutside);
  };
  const onKey     = (e) => { if (e.key === 'Escape') close(); };
  const onOutside = (e) => { if (!menu.contains(e.target)) close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('mousedown', onOutside), 50);

  document.getElementById('wk-ctx-monthly').addEventListener('click', () => {
    close();
    const [y, m] = dateStr.split('-').map(Number);
    _setViewActive('month');
    Calendar.setHighlightDate(dateStr);
    CalendarWeek.clearSelection();
    _hideSelectionBar();
    Calendar.renderMonth(y, m - 1);
  });

  document.getElementById('wk-ctx-holiday').addEventListener('click', () => {
    close();
    // Use the day column element as anchor for the popover
    const col = document.querySelector(`.cal-wk__day-col[data-date="${dateStr}"]`);
    _openHolidayPopover(col || document.getElementById('calendar-body'), dateStr);
  });
}

function _openHolidayPopover(anchorEl, dateStr) {
  // Cerrar popovers previos
  document.getElementById('holiday-popover')?.remove();

  const existing = (Store.getState().holidays || []).find(h => h.date === dateStr) || null;
  const rect = anchorEl.getBoundingClientRect();

  const pop = document.createElement('div');
  pop.id = 'holiday-popover';
  pop.className = 'cal-popup holiday-popover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-modal', 'false');
  pop.setAttribute('aria-label', 'Marcar fecha como festivo o cierre');

  pop.innerHTML = `
    <div class="cal-popup__header hpop__header">
      <div class="hpop__header-icon" aria-hidden="true">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <div class="hpop__header-text">
        <span class="cal-popup__title">${Utils.formatDateShort(dateStr)}</span>
        <span class="hpop__header-sub">${existing ? (existing.type === 'holiday' ? 'Día festivo' : 'Cierre institucional') : 'Marcar fecha'}</span>
      </div>
      <button class="cal-popup__close" id="holiday-pop-close" aria-label="Cerrar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="cal-popup__body hpop__body">
      ${existing ? `
        <div class="hpop__existing">
          <div class="hpop__existing-name">${Utils.escapeHTML(existing.name)}</div>
          <div class="hpop__existing-type">
            <span class="badge ${existing.type === 'holiday' ? 'badge-warning' : 'badge-neutral'}">
              ${existing.type === 'holiday' ? 'Festivo' : 'Cierre'}
            </span>
          </div>
        </div>
        <button class="btn btn-danger btn-sm hpop__remove-btn" id="holiday-pop-remove">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
          </svg>
          Quitar marca
        </button>
      ` : `
        <div class="rmodal__field">
          <label class="hpop__label" for="holiday-pop-name">Nombre de la fecha</label>
          <input type="text" id="holiday-pop-name" class="form-input hpop__input"
                 placeholder="Ej: Día del trabajo" maxlength="200" />
        </div>
        <div class="rmodal__field">
          <label class="hpop__label">Tipo</label>
          <div class="hpop__type-group">
            <label class="hpop__type-opt">
              <input type="radio" name="holiday-pop-type" value="holiday" checked />
              <span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                Festivo
              </span>
            </label>
            <label class="hpop__type-opt">
              <input type="radio" name="holiday-pop-type" value="closure" />
              <span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Cierre
              </span>
            </label>
          </div>
        </div>
        <button class="btn btn-primary btn-sm hpop__save-btn" id="holiday-pop-save">
          Marcar fecha
        </button>
      `}
    </div>`;

  document.body.appendChild(pop);

  // Posicionar
  const pw = 280;
  let left = rect.left;
  let top  = rect.bottom + 4;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 4;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top  = `${Math.max(8, top)}px`;

  // Focus name input if adding new
  if (!existing) {
    setTimeout(() => document.getElementById('holiday-pop-name')?.focus(), 30);
  }

  // Wire eventos
  const closePop = () => pop.remove();
  document.getElementById('holiday-pop-close')?.addEventListener('click', closePop);

  const _refreshCalendar = (date) => {
    if (Calendar.getCurrentView() === 'week') {
      Calendar.renderWeek(new Date(`${date}T00:00:00`), Calendar.getHighlightDate());
    } else {
      Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
    }
  };

  document.getElementById('holiday-pop-save')?.addEventListener('click', async () => {
    const name = document.getElementById('holiday-pop-name').value.trim();
    const type = pop.querySelector('input[name="holiday-pop-type"]:checked')?.value ?? 'holiday';
    if (!name) {
      Toast?.show('Escribe un nombre para la fecha.', 'warning');
      return;
    }
    const result = await Holidays.add({ date: dateStr, name, type });
    if (result.success) {
      Toast?.show('Fecha marcada.', 'success');
      closePop();
      _refreshCalendar(dateStr);
    } else {
      Toast?.show(result.error || 'Error al marcar la fecha.', 'error');
    }
  });

  document.getElementById('holiday-pop-remove')?.addEventListener('click', async () => {
    const ok = await Holidays.remove(existing.id);
    if (ok) {
      Toast?.show('Marca eliminada.', 'success');
      closePop();
      _refreshCalendar(dateStr);
    } else {
      Toast?.show('No se pudo eliminar.', 'error');
    }
  });

  // Cerrar al hacer click fuera o ESC
  const onKey = (e) => { if (e.key === 'Escape') { closePop(); document.removeEventListener('keydown', onKey); } };
  const onOutside = (e) => { if (!pop.contains(e.target)) { closePop(); document.removeEventListener('click', onOutside); } };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('click', onOutside), 50);
}

function _setViewActive(view) {
  document.getElementById('view-month')?.classList.toggle('active', view === 'month');
  document.getElementById('view-week')?.classList.toggle('active',  view === 'week');
  document.getElementById('view-month')?.setAttribute('aria-pressed', String(view === 'month'));
  document.getElementById('view-week')?.setAttribute('aria-pressed',  String(view === 'week'));
}

/* ════════════════════════════════════════
   DRAG-TO-RESCHEDULE
   ════════════════════════════════════════ */
function _onBlockDrop(id, reservation, target, dropX, dropY) {
  if (!target) return;

  const { date, startTime, endTime } = target;

  // No-op if dropped on same slot
  if (reservation.date === date &&
      reservation.startTime === startTime &&
      reservation.endTime === endTime) return;

  // Client-side conflict check (exclude the reservation being moved)
  if (_dragHasConflict(id, date, startTime, endTime)) {
    Modal.confirm(
      {
        title:       'Horario no disponible',
        message:     `El horario <strong>${startTime}–${endTime}</strong> del ${Utils.formatDateLong(date)} ya está ocupado por otra reservación.`,
        confirmText: 'Entendido',
      },
      () => {}
    );
    return;
  }

  if (reservation.isRecurring && reservation.recurringGroupId) {
    Modal.choice(
      {
        title:       'Mover reservación recurrente',
        message:     `<strong>${Utils.escapeHTML(reservation.responsible)}</strong><br>
                      Esta reservación pertenece a una serie recurrente. ¿Qué deseas mover?`,
        option1Text: 'Solo esta instancia',
        option2Text: 'Toda la serie (misma hora)',
      },
      () => _showDragConfirmOverlay(id, reservation, target, dropX, dropY, false),
      () => _showDragConfirmOverlay(id, reservation, target, dropX, dropY, true),
    );
  } else {
    _showDragConfirmOverlay(id, reservation, target, dropX, dropY, false);
  }
}

function _dragHasConflict(excludeId, date, startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const newStart = sh * 60 + sm;
  const newEnd   = eh * 60 + em;
  return Store.getState().reservations.some(r => {
    if (r.id === excludeId || r.status !== 'active' || r.date !== date) return false;
    const [rsh, rsm] = r.startTime.split(':').map(Number);
    const [reh, rem] = r.endTime.split(':').map(Number);
    return (rsh * 60 + rsm) < newEnd && (reh * 60 + rem) > newStart;
  });
}

function _showDragConfirmOverlay(id, reservation, target, dropX, dropY, moveSeries) {
  document.getElementById('drag-confirm-overlay')?.remove();

  const { date, startTime, endTime } = target;
  const seriesBadge = moveSeries
    ? `<span class="badge badge-warning" style="font-size:10px;display:inline-block;margin-top:4px;">Toda la serie</span>`
    : '';

  const overlay = document.createElement('div');
  overlay.id        = 'drag-confirm-overlay';
  overlay.className = 'drag-confirm-overlay';
  overlay.setAttribute('role',       'dialog');
  overlay.setAttribute('aria-label', 'Confirmar movimiento de reservación');

  overlay.innerHTML = `
    <div class="drag-overlay__header">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <polyline points="5 9 2 12 5 15"/>
        <polyline points="9 5 12 2 15 5"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <line x1="12" y1="2" x2="12" y2="22"/>
      </svg>
      ¿Confirmar movimiento?
    </div>
    <div class="drag-overlay__body">
      <strong>${Utils.escapeHTML(reservation.responsible)}</strong><br>
      ${Utils.formatDateLong(date)} · ${startTime}–${endTime}
      ${seriesBadge}
    </div>
    <div class="drag-overlay__actions">
      <button class="btn btn-ghost btn-sm"    id="drag-overlay-cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm"  id="drag-overlay-ok">Confirmar</button>
    </div>`;

  document.body.appendChild(overlay);

  // Position near drop point, flip if overflowing viewport
  const OW = 250, OH = 130;
  let left = dropX + 12;
  let top  = dropY - 40;
  if (left + OW > window.innerWidth  - 8) left = dropX - OW - 12;
  if (top  < 8)                           top  = 8;
  if (top  + OH > window.innerHeight - 8) top  = window.innerHeight - OH - 8;
  overlay.style.left = `${Math.max(8, left)}px`;
  overlay.style.top  = `${Math.max(8, top)}px`;

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  document.getElementById('drag-overlay-cancel').addEventListener('click', close);

  document.getElementById('drag-overlay-ok').addEventListener('click', async () => {
    close();
    await _executeDragMove(id, reservation, target, moveSeries);
  });

  setTimeout(() => {
    const onOutside = (e) => {
      if (!overlay.contains(e.target)) {
        close();
        document.removeEventListener('click', onOutside);
      }
    };
    document.addEventListener('click', onOutside);
  }, 50);
}

async function _executeDragMove(id, reservation, target, moveSeries) {
  const { date, startTime, endTime } = target;

  try {
    if (moveSeries) {
      const group = Store.getState().reservations.filter(r =>
        r.recurringGroupId === reservation.recurringGroupId && r.status === 'active'
      );
      const msPerDay = 1000 * 60 * 60 * 24;
      const dayDelta = Math.round(
        (new Date(`${date}T00:00:00`) - new Date(`${reservation.date}T00:00:00`)) / msPerDay
      );

      if (dayDelta !== 0) {
        const holidaySet = new Set((Store.getState().holidays || []).map(h => h.date));
        const blocked = group.filter(r => {
          const d = new Date(`${r.date}T00:00:00`);
          d.setDate(d.getDate() + dayDelta);
          const dow = d.getDay();
          return dow === 0 || dow === 6 || holidaySet.has(Utils.dateToISO(d));
        });
        if (blocked.length) {
          Modal.confirm(
            {
              title:       'Fechas no disponibles',
              message:     `${blocked.length} instancia${blocked.length !== 1 ? 's caerían' : ' caería'} en fin de semana o día festivo. Mueve solo esta instancia o elige otro día.`,
              confirmText: 'Entendido',
            },
            () => {}
          );
          return;
        }
      }

      await Promise.all(group.map(r => {
        const d = new Date(`${r.date}T00:00:00`);
        d.setDate(d.getDate() + dayDelta);
        const newDate = Utils.dateToISO(d);
        return API.updateReservation(r.id, {
          start_time: `${newDate}T${startTime}:00`,
          end_time:   `${newDate}T${endTime}:00`,
        });
      }));
      Toast.show(`Serie actualizada: ${group.length} instancia${group.length !== 1 ? 's' : ''}.`, 'success');
    } else {
      await API.updateReservation(id, {
        start_time: `${date}T${startTime}:00`,
        end_time:   `${date}T${endTime}:00`,
      });
      Toast.show('Reservación movida.', 'success');
    }

    const reservations = await API.getReservations();
    Store.setState({ reservations });
    _renderStats();
    _renderUpcoming();
    if (Calendar.getCurrentView() === 'week') {
      Calendar.renderWeek(new Date(`${date}T00:00:00`), Calendar.getHighlightDate());
    } else {
      Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
    }
  } catch (err) {
    const msg = err?.status === 409
      ? 'El horario ya está ocupado por otra reservación.'
      : 'No se pudo mover la reservación. Intenta de nuevo.';
    Toast.show(msg, 'error');
  }
}

/* ════════════════════════════════════════
   REDIMENSIONADO DE RESERVACIÓN
   ════════════════════════════════════════ */
function _onBlockResize(id, reservation, newEndTime, dropX, dropY) {
  const { date, startTime } = reservation;

  if (_dragHasConflict(id, date, startTime, newEndTime)) {
    Modal.confirm(
      {
        title:       'Horario no disponible',
        message:     `El horario <strong>${startTime}–${newEndTime}</strong> del ${Utils.formatDateLong(date)} ya está ocupado por otra reservación.`,
        confirmText: 'Entendido',
      },
      () => {}
    );
    return;
  }

  if (reservation.isRecurring && reservation.recurringGroupId) {
    Modal.choice(
      {
        title:       'Modificar duración',
        message:     `<strong>${Utils.escapeHTML(reservation.responsible)}</strong><br>
                      Esta reservación pertenece a una serie recurrente.`,
        option1Text: 'Solo esta instancia',
        option2Text: 'Toda la serie',
      },
      () => _showResizeConfirmOverlay(id, reservation, newEndTime, dropX, dropY, false),
      () => _showResizeConfirmOverlay(id, reservation, newEndTime, dropX, dropY, true),
    );
  } else {
    _showResizeConfirmOverlay(id, reservation, newEndTime, dropX, dropY, false);
  }
}

function _showResizeConfirmOverlay(id, reservation, newEndTime, dropX, dropY, resizeSeries) {
  document.getElementById('drag-confirm-overlay')?.remove();

  const seriesBadge = resizeSeries
    ? `<span class="badge badge-warning" style="font-size:10px;display:inline-block;margin-top:4px;">Toda la serie</span>`
    : '';

  const overlay = document.createElement('div');
  overlay.id        = 'drag-confirm-overlay';
  overlay.className = 'drag-confirm-overlay';
  overlay.setAttribute('role',       'dialog');
  overlay.setAttribute('aria-label', 'Confirmar cambio de duración');

  overlay.innerHTML = `
    <div class="drag-overlay__header">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>
      </svg>
      ¿Confirmar nueva duración?
    </div>
    <div class="drag-overlay__body">
      <strong>${Utils.escapeHTML(reservation.responsible)}</strong><br>
      ${Utils.formatDateLong(reservation.date)} · ${reservation.startTime}–${newEndTime}
      ${seriesBadge}
    </div>
    <div class="drag-overlay__actions">
      <button class="btn btn-ghost btn-sm"   id="drag-overlay-cancel">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="drag-overlay-ok">Confirmar</button>
    </div>`;

  document.body.appendChild(overlay);

  const OW = 250, OH = 130;
  let left = dropX + 12;
  let top  = dropY - 40;
  if (left + OW > window.innerWidth  - 8) left = dropX - OW - 12;
  if (top  < 8)                           top  = 8;
  if (top  + OH > window.innerHeight - 8) top  = window.innerHeight - OH - 8;
  overlay.style.left = `${Math.max(8, left)}px`;
  overlay.style.top  = `${Math.max(8, top)}px`;

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };

  document.getElementById('drag-overlay-cancel').addEventListener('click', close);
  document.getElementById('drag-overlay-ok').addEventListener('click', async () => {
    close();
    await _executeResize(id, reservation, newEndTime, resizeSeries);
  });

  setTimeout(() => {
    const onOutside = (e) => {
      if (!overlay.contains(e.target)) {
        close();
        document.removeEventListener('click', onOutside);
      }
    };
    document.addEventListener('click', onOutside);
  }, 50);
}

async function _executeResize(id, reservation, newEndTime, resizeSeries) {
  const { date, startTime } = reservation;
  try {
    if (resizeSeries) {
      const group = Store.getState().reservations.filter(r =>
        r.recurringGroupId === reservation.recurringGroupId && r.status === 'active'
      );
      await Promise.all(group.map(r =>
        API.updateReservation(r.id, {
          start_time: `${r.date}T${r.startTime}:00`,
          end_time:   `${r.date}T${newEndTime}:00`,
        })
      ));
      Toast.show(`Serie actualizada: ${group.length} instancia${group.length !== 1 ? 's' : ''}.`, 'success');
    } else {
      await API.updateReservation(id, {
        start_time: `${date}T${startTime}:00`,
        end_time:   `${date}T${newEndTime}:00`,
      });
      Toast.show('Duración actualizada.', 'success');
    }

    const reservations = await API.getReservations();
    Store.setState({ reservations });
    _renderStats();
    _renderUpcoming();
    if (Calendar.getCurrentView() === 'week') {
      Calendar.renderWeek(new Date(`${date}T00:00:00`), Calendar.getHighlightDate());
    } else {
      Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
    }
  } catch (err) {
    const msg = err?.status === 409
      ? 'El horario ya está ocupado por otra reservación.'
      : 'No se pudo actualizar la reservación.';
    Toast.show(msg, 'error');
  }
}

