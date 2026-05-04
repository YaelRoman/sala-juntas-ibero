/* ============================================================
   CALENDAR-PAGE.JS — Lógica de la vista calendario completa
   HU-02 (académico solo lectura), HU-04 (ver disponibilidad),
   HU-06 (ver responsable), HU-07 (nav sin restricción), HU-13
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  Store.init();
  const user = Auth.requireAuth();
  if (!user) return;

  // Secretarias should use the dashboard which already has calendar — redirect
  if (user.role === 'secretaria') {
    window.location.href = 'dashboard.html';
    return;
  }

  // Load fresh data from API (API is source of truth)
  try {
    const [reservations, holidays] = await Promise.all([
      API.getReservations(),
      API.getHolidays()
    ]);
    Store.setState({ reservations, holidays });
  } catch (err) {
    console.error('Error loading calendar data:', err);
    Toast.show('Error cargando datos del calendario', 'error');
  }

  const isSecretary = user.role === 'secretaria';

  // ── Sidebar ──
  Sidebar.init('calendar');

  // ── Topbar role badge ──
  const badge = document.getElementById('topbar-role-badge');
  if (badge) {
    badge.textContent = isSecretary ? 'Secretaria' : 'Académico';
    badge.className   = `badge ${isSecretary ? 'badge-primary' : 'badge-info'} topbar__badge-role`;
  }

  // ── Read-only banner for académico (HU-02, HU-13) ──
  if (!isSecretary) {
    document.getElementById('readonly-banner')?.classList.remove('hidden');
  }

  // ── Show "Nueva Reservación" button only for secretaria ──
  if (isSecretary) {
    const btnNueva = document.getElementById('btn-nueva-reserva');
    if (btnNueva) {
      btnNueva.style.display = '';
      btnNueva.addEventListener('click', () => { window.location.href = 'reservacion.html'; });
    }
    const fab = document.getElementById('fab-container');
    if (fab) fab.style.display = '';
    document.getElementById('fab-nueva')?.addEventListener('click', () => {
      window.location.href = 'reservacion.html';
    });
  }

  // ── Init Calendar module ──
  Calendar.init({
    containerId:        'cal-body',
    titleId:            'cal-title',
    editable:           isSecretary,
    onDayClick:         isSecretary ? _onDayClick : null,
    onReservationClick: _onReservationClick,
  });

  // ── Nav buttons ──
  document.getElementById('cal-prev')?.addEventListener('click',  () => Calendar.navigateTo('prev'));
  document.getElementById('cal-next')?.addEventListener('click',  () => Calendar.navigateTo('next'));
  document.getElementById('cal-today')?.addEventListener('click', () => Calendar.navigateTo('today'));

  // ── View toggle ──
  document.getElementById('view-month')?.addEventListener('click', () => {
    _setViewActive('month');
    Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth());
  });
  document.getElementById('view-week')?.addEventListener('click', () => {
    _setViewActive('week');
    Calendar.renderWeek(new Date());
  });

  Auth.startInactivityWatcher();
});

/* ── VIEW TOGGLE HELPER ── */
function _setViewActive(view) {
  const monthBtn = document.getElementById('view-month');
  const weekBtn  = document.getElementById('view-week');
  monthBtn?.classList.toggle('active', view === 'month');
  weekBtn?.classList.toggle('active',  view === 'week');
  monthBtn?.setAttribute('aria-pressed', String(view === 'month'));
  weekBtn?.setAttribute('aria-pressed',  String(view === 'week'));
}

/* ── CLICK EN DÍA / SLOT (secretaria) ── */
function _onDayClick(dateStr, hourStr) {
  Store.setState({ selectedDate: dateStr });
  const params = hourStr ? `?date=${dateStr}&time=${hourStr}` : `?date=${dateStr}`;
  window.location.href = `reservacion.html${params}`;
}

/* ── CLICK EN RESERVACIÓN (ambos roles) — HU-06, HU-14 ── */
function _onReservationClick(id, event) {
  const { reservations } = Store.getState();
  const r = reservations.find(res => res.id === id);
  if (!r) return;

  _closePopup();

  const user        = Store.getUser();
  const isSecretary = user?.role === 'secretaria';
  const rect        = event.currentTarget.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id        = 'cal-popup';
  popup.className = 'cal-popup';
  popup.setAttribute('role',       'dialog');
  popup.setAttribute('aria-modal', 'true');
  popup.setAttribute('aria-label', 'Detalle de reservación');
  popup.setAttribute('tabindex',   '-1');

  const statusBadge = r.status === 'cancelled'
    ? `<span class="badge badge-error" style="font-size:10px;">Cancelada</span>`
    : `<span class="badge badge-success" style="font-size:10px;">Activa</span>`;

  const actions = isSecretary && r.status === 'active' ? `
    <div class="cal-popup__actions">
      <button class="btn btn-secondary btn-sm" id="popup-edit">Editar</button>
      <button class="btn btn-danger btn-sm"    id="popup-cancel">Cancelar</button>
    </div>` : '';

  popup.innerHTML = `
    <div class="cal-popup__header">
      <span class="cal-popup__title">${Utils.escapeHTML(r.responsible)}</span>
      <button class="cal-popup__close" id="popup-close" aria-label="Cerrar">
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
          <rect x="3" y="4" width="18" height="18" rx="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
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
      <div class="cal-popup__row" style="margin-bottom:0;">${statusBadge}</div>
    </div>
    ${actions}`;

  document.body.appendChild(popup);

  // Position
  _positionPopup(popup, rect);

  // Wire buttons
  document.getElementById('popup-close')?.addEventListener('click', _closePopup);
  document.getElementById('popup-edit')?.addEventListener('click', () => {
    _closePopup();
    ReservationModal.open({
      editReservation: r,
      onSaved: () => Calendar.renderMonth(Calendar.getCurrentYear(), Calendar.getCurrentMonth()),
    });
  });
  document.getElementById('popup-cancel')?.addEventListener('click', () => {
    _closePopup();
    _cancelReservation(r);
  });

  // Close on Escape or outside click
  const onKey     = (e) => { if (e.key === 'Escape') _closePopup(); };
  const onOutside = (e) => { if (!popup.contains(e.target)) _closePopup(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('click', onOutside), 50);
  popup._cleanup = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside);
  };

  popup.focus();
}

function _positionPopup(popup, triggerRect) {
  const pw = 280;
  const ph = popup.offsetHeight || 260;
  let left = triggerRect.right + 8;
  let top  = triggerRect.top;

  if (left + pw > window.innerWidth - 8)  left = triggerRect.left - pw - 8;
  if (top + ph  > window.innerHeight - 8) top  = window.innerHeight - ph - 8;
  if (top < 8) top = 8;
  if (left < 8) left = 8;

  popup.style.left = `${left}px`;
  popup.style.top  = `${top}px`;
}

function _closePopup() {
  const p = document.getElementById('cal-popup');
  if (p) { p._cleanup?.(); p.remove(); }
}

/* ── CANCELAR RESERVACIÓN ── */
function _cancelReservation(r) {
  const _refresh = () => Calendar.renderMonth(
    Calendar.getCurrentYear(), Calendar.getCurrentMonth()
  );

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
        Reservations.cancel(r.id);
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
        Reservations.cancel(r.id);
        Toast.show('Reservación cancelada.', 'success');
        _refresh();
      }
    );
  }
}

