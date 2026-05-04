/* ============================================================
   MINI-CALENDAR.JS — Selector de fecha compacto (sidebar)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const MiniCalendar = (() => {

  const DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  let _containerId = null;
  let _year        = new Date().getFullYear();
  let _month       = new Date().getMonth(); // 0-based
  let _highlight   = null;  // "YYYY-MM-DD" — día seleccionado
  let _holidays    = [];
  let _onDayClick  = null;

  /* ─────────────────────────────────────────
     PUBLIC API
  ───────────────────────────────────────── */

  const init = ({ containerId, holidays = [], onDayClick = null }) => {
    _containerId = containerId;
    _holidays    = holidays;
    _onDayClick  = onDayClick;
    _renderAndWire();
  };

  const setHighlight = (dateStr) => {
    _highlight = dateStr;
    if (dateStr) {
      const [y, m] = dateStr.split('-').map(Number);
      _year  = y;
      _month = m - 1;
    }
    _renderAndWire();
  };

  const clearHighlight = () => {
    _highlight = null;
    _renderAndWire();
  };

  const setMonth = (year, month) => {
    _year  = year;
    _month = month;
    _renderAndWire();
  };

  const updateHolidays = (holidays) => {
    _holidays = holidays;
    _renderAndWire();
  };

  /* ─────────────────────────────────────────
     RENDER
  ───────────────────────────────────────── */

  const _renderAndWire = () => {
    const container = document.getElementById(_containerId);
    if (!container) return;

    const today      = Utils.today();
    const holidaySet = new Set(_holidays.map(h => (h.date || '').substring(0, 10)));

    // Week highlight range (Mon–Sun of the highlighted day)
    let weekStart = null, weekEnd = null;
    if (_highlight) {
      const ws = _getMonday(_highlight);
      const we = new Date(`${ws}T00:00:00`);
      we.setDate(we.getDate() + 6);
      weekStart = ws;
      weekEnd   = Utils.dateToISO(we);
    }

    const firstDow  = Utils.firstDayOfMonth(_year, _month); // Mon=0 … Sun=6
    const totalDays = Utils.daysInMonth(_year, _month);

    // Previous-month trailing days
    const prevYear  = _month === 0 ? _year - 1 : _year;
    const prevMonth = _month === 0 ? 11 : _month - 1;
    const prevTotal = Utils.daysInMonth(prevYear, prevMonth);

    let cells = '';

    // Leading overflow from prev month
    for (let i = 0; i < firstDow; i++) {
      const day = prevTotal - firstDow + i + 1;
      const iso = _iso(prevYear, prevMonth + 1, day);
      cells += `<div class="mini-cal__day is-other-month"><span class="mini-cal__num">${day}</span></div>`;
    }

    // Current month
    for (let d = 1; d <= totalDays; d++) {
      const iso = _iso(_year, _month + 1, d);
      const dow = (firstDow + d - 1) % 7; // 0=Mon … 6=Sun

      const inWeek     = weekStart && iso >= weekStart && iso <= weekEnd;
      const isToday    = iso === today;
      const isSelected = iso === _highlight;
      const isHoliday  = holidaySet.has(iso);
      const isWeekend  = dow >= 5;

      const cls = [
        'mini-cal__day',
        isToday    ? 'is-today'          : '',
        isSelected ? 'is-selected'       : '',
        inWeek     ? 'is-week-highlight' : '',
        isHoliday  ? 'is-holiday'        : '',
        isWeekend  ? 'is-weekend'        : '',
      ].filter(Boolean).join(' ');

      cells += `<div class="${cls}" data-date="${iso}" role="button" tabindex="0" aria-label="${iso}">
        <span class="mini-cal__num">${d}</span>
      </div>`;
    }

    // Trailing overflow into next month
    const totalCells = firstDow + totalDays;
    const trailing   = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    const nextYear   = _month === 11 ? _year + 1 : _year;
    const nextMonth  = _month === 11 ? 0 : _month + 1;
    for (let d = 1; d <= trailing; d++) {
      const iso = _iso(nextYear, nextMonth + 1, d);
      cells += `<div class="mini-cal__day is-other-month"><span class="mini-cal__num">${d}</span></div>`;
    }

    container.innerHTML = `
      <div class="mini-cal__header">
        <button class="cal-nav-btn mini-cal__prev" aria-label="Mes anterior">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span class="mini-cal__title">${Utils.monthName(_month)} ${_year}</span>
        <button class="cal-nav-btn mini-cal__next" aria-label="Mes siguiente">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
      <div class="mini-cal__grid">
        ${DOW.map(d => `<div class="mini-cal__dow">${d}</div>`).join('')}
        ${cells}
      </div>`;

    // Wire events after render
    container.querySelector('.mini-cal__prev')?.addEventListener('click', _prevMonth);
    container.querySelector('.mini-cal__next')?.addEventListener('click', _nextMonth);
    container.querySelectorAll('.mini-cal__day:not(.is-other-month)').forEach(el => {
      el.addEventListener('click', () => _onCellClick(el.dataset.date));
    });
  };

  /* ─────────────────────────────────────────
     PRIVATE HELPERS
  ───────────────────────────────────────── */

  const _prevMonth = () => {
    if (_month === 0) { _year--; _month = 11; }
    else { _month--; }
    _renderAndWire();
  };

  const _nextMonth = () => {
    if (_month === 11) { _year++; _month = 0; }
    else { _month++; }
    _renderAndWire();
  };

  const _onCellClick = (dateStr) => {
    if (!dateStr) return;
    _highlight = dateStr;
    _renderAndWire();
    _onDayClick?.(dateStr);
  };

  const _getMonday = (dateStr) => {
    const d   = new Date(`${dateStr}T00:00:00`);
    const day = d.getDay(); // 0=Sun
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return Utils.dateToISO(d);
  };

  const _iso = (y, m, d) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  return { init, setHighlight, clearHighlight, setMonth, updateHolidays };
})();
