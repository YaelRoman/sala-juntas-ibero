/* ============================================================
   CALENDAR.JS — Módulo de calendario maestro
   HU-04 (vista disponibilidad), HU-05 (festivos/cierres),
   HU-06 (ver responsable), HU-07 (navegación anual libre)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const Calendar = (() => {

  /* ── ESTADO INTERNO ── */
  let _year        = new Date().getFullYear();
  let _month       = new Date().getMonth();   // 0-based
  let _view        = 'month';                 // 'month' | 'week'
  let _weekStart   = null;                    // Date: lunes de la semana visible
  let _containerId = 'cal-body';
  let _titleId     = 'cal-title';
  let _editable    = false;
  let _onDayClick         = null;
  let _onReservationClick = null;
  let _selectable         = false;
  let _onSelectionChange  = null;
  let _onCommitSelection  = null;
  let _highlightDate      = null;

  /* ════════════════════════════════════════
     INIT
     ════════════════════════════════════════ */
  /**
   * @param {object}   opts
   * @param {string}   opts.containerId
   * @param {string}   [opts.titleId]
   * @param {boolean}  [opts.editable]
   * @param {Function} [opts.onDayClick]         (dateStr, hourStr?) => void
   * @param {Function} [opts.onReservationClick] (id, event) => void
   */
  const init = (opts = {}) => {
    _containerId        = opts.containerId         ?? 'cal-body';
    _titleId            = opts.titleId             ?? 'cal-title';
    _editable           = opts.editable            ?? false;
    _onDayClick         = opts.onDayClick          ?? null;
    _onReservationClick = opts.onReservationClick  ?? null;
    _selectable         = opts.selectable          ?? false;
    _onSelectionChange  = opts.onSelectionChange   ?? null;
    _onCommitSelection  = opts.onCommitSelection   ?? null;

    const state = Store.getState();
    _year  = state.currentYear  ?? new Date().getFullYear();
    _month = state.currentMonth ?? new Date().getMonth();

    renderMonth(_year, _month);
  };

  /* ════════════════════════════════════════
     RENDER MONTH
     ════════════════════════════════════════ */
  const renderMonth = (year, month) => {
    _view  = 'month';
    _year  = year;
    _month = month;
    Store.setState({ currentYear: year, currentMonth: month });

    const titleEl = document.getElementById(_titleId);
    if (titleEl) titleEl.textContent = `${Utils.monthName(month)} ${year}`;

    const { reservations, holidays } = Store.getState();

    CalendarGrid.render({
      containerId:        _containerId,
      year,
      month,
      reservations,
      holidays,
      editable:           _editable,
      onDayClick:         _onDayClick,
      onReservationClick: _onReservationClick,
      onMoreClick:        _onDayClick,
    });
  };

  /* ════════════════════════════════════════
     RENDER WEEK
     ════════════════════════════════════════ */
  /**
   * @param {Date} [dateInWeek] — cualquier fecha dentro de la semana deseada
   */
  const renderWeek = (dateInWeek, highlightDate = null) => {
    _view      = 'week';
    _weekStart = _getMonday(dateInWeek ?? new Date());
    if (highlightDate) _highlightDate = highlightDate;

    const titleEl = document.getElementById(_titleId);
    if (titleEl) {
      const endOfWeek = new Date(_weekStart);
      endOfWeek.setDate(endOfWeek.getDate() + 6);
      titleEl.textContent = _weekRangeLabel(_weekStart, endOfWeek);
    }

    const { reservations, holidays } = Store.getState();

    CalendarWeek.render({
      containerId:        _containerId,
      weekStart:          _weekStart,
      reservations,
      holidays,
      editable:           _editable,
      selectable:         _selectable,
      highlightDate:      _highlightDate,
      onSlotClick:        (!_selectable && _onDayClick)
                            ? (dateStr, hourStr) => _onDayClick(dateStr, hourStr)
                            : null,
      onReservationClick: _onReservationClick,
      onSelectionChange:  _onSelectionChange,
      onCommitSelection:  _onCommitSelection,
    });
  };

  /* ════════════════════════════════════════
     NAVIGATION — sin restricción de año (HU-07)
     ════════════════════════════════════════ */
  /**
   * @param {'prev'|'next'|'today'} direction
   */
  const navigateTo = (direction) => {
    if (_view === 'week') {
      if (direction === 'today') {
        renderWeek(new Date());
        return;
      }
      const d = new Date(_weekStart);
      d.setDate(d.getDate() + (direction === 'prev' ? -7 : 7));
      renderWeek(d);
      return;
    }

    // Vista mensual
    if (direction === 'today') {
      const now = new Date();
      renderMonth(now.getFullYear(), now.getMonth());
      return;
    }
    let y = _year;
    let m = _month;
    if (direction === 'prev') {
      m--;
      if (m < 0)  { m = 11; y--; }
    } else {
      m++;
      if (m > 11) { m = 0;  y++; }
    }
    renderMonth(y, m);
  };

  /* ════════════════════════════════════════
     MARK HELPERS — actualiza datos y re-renderiza
     ════════════════════════════════════════ */

  const markHolidays = (newHolidays) => {
    const existing = Store.getState().holidays.filter(h => h.type !== 'holiday');
    Store.setState({ holidays: [...existing, ...newHolidays] });
    Store.persist();
    _rerender();
  };

  const markClosed = (newClosures) => {
    const existing = Store.getState().holidays.filter(h => h.type !== 'closure');
    Store.setState({ holidays: [...existing, ...newClosures] });
    Store.persist();
    _rerender();
  };

  const renderReservations = (reservations) => {
    Store.setState({ reservations });
    Store.persist();
    _rerender();
  };

  /* ════════════════════════════════════════
     ACCESSORS
     ════════════════════════════════════════ */
  const getCurrentYear  = () => _year;
  const getCurrentMonth = () => _month;
  const getCurrentView  = () => _view;
  const getHighlightDate = () => _highlightDate;
  const setHighlightDate = (d) => { _highlightDate = d; };

  /* ════════════════════════════════════════
     PRIVATE HELPERS
     ════════════════════════════════════════ */

  /** Re-renderiza la vista activa */
  const _rerender = () => {
    if (_view === 'week') renderWeek(_weekStart);
    else renderMonth(_year, _month);
  };

  /** Devuelve el lunes de la semana que contiene `date` */
  const _getMonday = (date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();                 // 0=Dom
    const diff = day === 0 ? -6 : 1 - day; // Dom → retrocede 6, otros → al lunes
    d.setDate(d.getDate() + diff);
    return d;
  };

  /** "7–13 Abr 2026" o "28 Abr–4 May 2026" */
  const _weekRangeLabel = (start, end) => {
    const months = ['Ene','Feb','Mar','Abr','May','Jun',
                    'Jul','Ago','Sep','Oct','Nov','Dic'];
    if (start.getMonth() === end.getMonth()) {
      return `${start.getDate()}–${end.getDate()} ${months[start.getMonth()]} ${start.getFullYear()}`;
    }
    return `${start.getDate()} ${months[start.getMonth()]} – ${end.getDate()} ${months[end.getMonth()]} ${end.getFullYear()}`;
  };

  return {
    init,
    renderMonth,
    renderWeek,
    navigateTo,
    markHolidays,
    markClosed,
    renderReservations,
    getCurrentYear,
    getCurrentMonth,
    getCurrentView,
    getHighlightDate,
    setHighlightDate,
  };
})();
