/* ============================================================
   CALENDAR-GRID.JS — Componente de cuadrícula mensual
   Reutilizable: dashboard, calendar.html, date-pickers
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const CalendarGrid = (() => {

  /**
   * Renderiza el grid mensual en un contenedor.
   *
   * @param {object}   opts
   * @param {string}   opts.containerId          — ID del elemento destino
   * @param {number}   opts.year
   * @param {number}   opts.month                — 0-based (0=Ene … 11=Dic)
   * @param {Array}    opts.reservations         — todas las reservaciones (se filtran internamente)
   * @param {Array}    opts.holidays             — array de { date, name, type }
   * @param {boolean}  [opts.editable=false]     — habilita celdas clickeables (secretaria)
   * @param {number}   [opts.maxPerDay=2]        — máx. bloques visibles por día antes de "+N más"
   * @param {Function} [opts.onDayClick]         — (dateStr) => void
   * @param {Function} [opts.onReservationClick] — (id, nativeEvent) => void
   * @param {Function} [opts.onMoreClick]        — (dateStr) => void
   */
  const render = (opts) => {
    const {
      containerId,
      year,
      month,
      reservations = [],
      holidays     = [],
      editable     = false,
      maxPerDay    = 2,
      onDayClick,
      onReservationClick,
      onMoreClick,
    } = opts;

    const containerEl = document.getElementById(containerId);
    if (!containerEl) return;

    const days     = Utils.daysInMonth(year, month);
    const startDay = Utils.firstDayOfMonth(year, month); // 0 = Lun
    const todayStr = Utils.today();
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Index reservations for this month by date
    const resByDate = {};
    reservations
      .filter(r => r.date.startsWith(monthStr))
      .forEach(r => {
        if (!resByDate[r.date]) resByDate[r.date] = [];
        resByDate[r.date].push(r);
      });

    // Index special dates (holidays / closures)
    const specialDates = {};
    holidays.forEach(h => { specialDates[h.date] = h; });

    // ── Build HTML ──
    let html = _buildWeekdayHeader();
    html += `<div class="cal-grid__days" role="grid" aria-label="Días de ${Utils.monthName(month)} ${year}">`;

    // Leading empty cells
    for (let i = 0; i < startDay; i++) {
      html += `<div class="cal-day is-other-month" aria-hidden="true"></div>`;
    }

    // Day cells
    for (let d = 1; d <= days; d++) {
      html += _buildDayCell({ d, year, month, todayStr, specialDates, resByDate, editable, maxPerDay });
    }

    // Trailing empty cells to complete last row
    const remainder = (startDay + days) % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) {
        html += `<div class="cal-day is-other-month" aria-hidden="true"></div>`;
      }
    }

    html += `</div>`; // .cal-grid__days
    containerEl.innerHTML = html;

    // ── Wire events ──
    _attachEvents(containerEl, { editable, onDayClick, onReservationClick, onMoreClick });
  };

  /* ── WEEKDAY HEADER ── */
  const _buildWeekdayHeader = () => `
    <div class="cal-grid__weekdays" role="row" aria-hidden="true">
      <div class="cal-grid__weekday">Lu</div>
      <div class="cal-grid__weekday">Ma</div>
      <div class="cal-grid__weekday">Mi</div>
      <div class="cal-grid__weekday">Ju</div>
      <div class="cal-grid__weekday">Vi</div>
      <div class="cal-grid__weekday">Sa</div>
      <div class="cal-grid__weekday">Do</div>
    </div>`;

  /* ── DAY CELL ── */
  const _buildDayCell = ({ d, year, month, todayStr, specialDates, resByDate, editable, maxPerDay }) => {
    const dateStr   = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const special   = specialDates[dateStr];
    const isHoliday = special?.type === 'holiday';
    const isClosed  = special?.type === 'closure';
    const isEvento  = special?.type === 'evento';
    const dayOfWeek = new Date(year, month, d).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isToday   = dateStr === todayStr;
    const isClickable = editable && !isHoliday && !isClosed && !isWeekend;

    const classes = [
      'cal-day',
      isToday     ? 'is-today'    : '',
      isHoliday   ? 'is-holiday'  : '',
      isClosed    ? 'is-closed'   : '',
      isEvento    ? 'is-evento'   : '',
      isWeekend   ? 'is-weekend'  : '',
      isClickable ? 'is-clickable': '',
    ].filter(Boolean).join(' ');

    const ariaLabel = [
      `${d} de ${Utils.monthName(month)}`,
      isToday ? '(hoy)' : '',
      special ? `— ${special.name}` : '',
    ].filter(Boolean).join(' ');

    const labelHTML = special
      ? `<span class="cal-day__label" title="${Utils.escapeHTML(special.name)}">${Utils.escapeHTML(Utils.truncate(special.name, 14))}</span>`
      : '';

    const dayRes  = (resByDate[dateStr] || []).filter(r => r.status !== 'cancelled');
    const visible = dayRes.slice(0, maxPerDay);
    const overflow = dayRes.length - visible.length;

    const resHTML = visible.map(r => _buildReservationBlock(r)).join('') +
      (overflow > 0
        ? `<div class="cal-more" data-date="${dateStr}" role="button" tabindex="0">+${overflow} más</div>`
        : '');

    const clickAttrs = isClickable
      ? `data-date="${dateStr}" role="button" tabindex="0"`
      : `role="gridcell"`;

    return `
      <div class="${classes}" ${clickAttrs} aria-label="${ariaLabel}">
        <span class="cal-day__number">${d}</span>
        ${labelHTML}
        ${resHTML}
      </div>`;
  };

  /* ── RESERVATION BLOCK ── */
  const _buildReservationBlock = (r) => {
    const cls = [
      'cal-reservation',
      r.isRecurring            ? 'is-recurring' : '',
      r.status === 'cancelled' ? 'is-cancelled' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${cls}" data-id="${r.id}"
           role="button" tabindex="0"
           aria-label="${Utils.escapeHTML(r.responsible)} — ${r.startTime}–${r.endTime}"
           title="${Utils.escapeHTML(r.responsible)} · ${Utils.escapeHTML(r.area)}">
        <span class="cal-reservation__time">${r.startTime}</span>
        <span class="cal-reservation__name">${Utils.escapeHTML(Utils.truncate(r.responsible, 18))}</span>
      </div>`;
  };

  /* ── EVENT WIRING ── */
  const _attachEvents = (containerEl, { editable, onDayClick, onReservationClick, onMoreClick }) => {
    if (editable && onDayClick) {
      containerEl.querySelectorAll('.cal-day.is-clickable[data-date]').forEach(cell => {
        cell.addEventListener('click', () => onDayClick(cell.dataset.date));
        cell.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDayClick(cell.dataset.date); }
        });
      });
    }

    if (onReservationClick) {
      containerEl.querySelectorAll('.cal-reservation[data-id]').forEach(block => {
        block.addEventListener('click', e => {
          e.stopPropagation();
          onReservationClick(block.dataset.id, e);
        });
        block.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onReservationClick(block.dataset.id, e);
          }
        });
      });
    }

    containerEl.querySelectorAll('.cal-more[data-date]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        onMoreClick?.(btn.dataset.date);
      });
    });
  };

  return { render };
})();
