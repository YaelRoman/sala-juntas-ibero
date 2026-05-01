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
  });

  if (isSecretary) {
    _initHolidayMarkingOnMonthly();
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
  countEl.textContent = `${selected.length} hora${selected.length !== 1 ? 's' : ''} seleccionada${selected.length !== 1 ? 's' : ''}`;
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
   MARCADO INLINE DE FESTIVOS / CIERRES
   Click derecho sobre un día en vista mensual abre un menú contextual.
   ════════════════════════════════════════ */
function _initHolidayMarkingOnMonthly() {
  const body = document.getElementById('calendar-body');
  if (!body) return;

  body.addEventListener('contextmenu', (e) => {
    // Sólo en vista mensual
    if (Calendar.getCurrentView() !== 'month') return;
    const cell = e.target.closest('.cal-day:not(.is-other-month)');
    if (!cell) return;

    // Las celdas marcadas no llevan data-date; intentamos leer del aria-label como fallback
    let date = cell.dataset.date;
    if (!date) {
      // Reconstruir desde el número del día visible + año/mes actuales del Calendar
      const num = parseInt(cell.querySelector('.cal-day__number')?.textContent ?? '', 10);
      if (!num) return;
      const y = Calendar.getCurrentYear();
      const m = Calendar.getCurrentMonth();
      date = `${y}-${String(m+1).padStart(2,'0')}-${String(num).padStart(2,'0')}`;
    }

    e.preventDefault();
    _openHolidayPopover(cell, date);
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
    <div class="cal-popup__header">
      <span class="cal-popup__title">${Utils.formatDateShort(dateStr)}</span>
      <button class="cal-popup__close" id="holiday-pop-close" aria-label="Cerrar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="cal-popup__body">
      ${existing ? `
        <div class="cal-popup__row">
          <span class="badge ${existing.type === 'holiday' ? 'badge-warning' : 'badge-neutral'}">
            ${existing.type === 'holiday' ? 'Día festivo' : 'Cierre institucional'}
          </span>
          <span class="cal-popup__value">${Utils.escapeHTML(existing.name)}</span>
        </div>
        <button class="btn btn-danger btn-sm" id="holiday-pop-remove" style="width:100%;margin-top:var(--space-2);">
          Quitar marca
        </button>
      ` : `
        <label class="cal-popup__label" for="holiday-pop-name">Nombre</label>
        <input type="text" id="holiday-pop-name" class="form-control"
               placeholder="Ej: Día del trabajo" maxlength="200" />
        <label class="cal-popup__label" for="holiday-pop-type" style="margin-top:var(--space-2);">Tipo</label>
        <select id="holiday-pop-type" class="form-control">
          <option value="holiday">Día festivo</option>
          <option value="closure">Cierre institucional</option>
        </select>
        <button class="btn btn-primary btn-sm" id="holiday-pop-save" style="width:100%;margin-top:var(--space-3);">
          Marcar
        </button>
      `}
    </div>`;

  document.body.appendChild(pop);

  // Posicionar
  const pw = 240;
  let left = rect.left;
  let top  = rect.bottom + 4;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  if (top + pop.offsetHeight > window.innerHeight - 8) top = rect.top - pop.offsetHeight - 4;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top  = `${Math.max(8, top)}px`;

  // Wire eventos
  const closePop = () => pop.remove();
  document.getElementById('holiday-pop-close')?.addEventListener('click', closePop);

  document.getElementById('holiday-pop-save')?.addEventListener('click', async () => {
    const name = document.getElementById('holiday-pop-name').value.trim();
    const type = document.getElementById('holiday-pop-type').value;
    if (!name) {
      Toast?.show('Escribe un nombre para la fecha.', 'warning');
      return;
    }
    const result = await Holidays.add({ date: dateStr, name, type });
    if (result.success) {
      Toast?.show('Fecha marcada.', 'success');
      closePop();
      Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
    } else {
      Toast?.show(result.error || 'Error al marcar la fecha.', 'error');
    }
  });

  document.getElementById('holiday-pop-remove')?.addEventListener('click', async () => {
    const ok = await Holidays.remove(existing.id);
    if (ok) {
      Toast?.show('Marca eliminada.', 'success');
      closePop();
      Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
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

