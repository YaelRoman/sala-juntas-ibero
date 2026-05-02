/* ============================================================
   CALENDAR-WEEK.JS — Componente de vista semanal
   HU-04 (disponibilidad), HU-06 (responsable), HU-07 (navegación)
   Soporta selección de múltiples horas (click, arrastre, Ctrl+click)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const CalendarWeek = (() => {

  const HOUR_START = 7;
  const HOUR_END   = 20;
  const SLOT_H     = 60;                              // px por hora
  const TOTAL_H    = (HOUR_END - HOUR_START) * SLOT_H; // 720px

  /* ── ESTADO INTERNO DE SELECCIÓN ── */
  let _selection      = new Set();   // claves "YYYY-MM-DD|HH:MM"
  let _container      = null;
  let _selectable     = false;
  let _onSelectionCb  = null;
  let _onCommitCb     = null;
  let _disabledKeys   = new Set();   // slots no clickeables (festivo, fin de semana, ocupado)
  let _partialBlocks  = new Map();   // key -> [{top, height}] px dentro del slot
  let _dragAnchor     = null;        // {dateIso, hour, additive}
  let _dragMoved      = false;

  /* ════════════════════════════════════════
     PUBLIC: render
     ════════════════════════════════════════ */
  /**
   * @param {object}   opts
   * @param {string}   opts.containerId
   * @param {Date}     opts.weekStart          — Lunes de la semana a mostrar
   * @param {Array}    opts.reservations
   * @param {Array}    opts.holidays
   * @param {boolean}  opts.editable
   * @param {boolean}  [opts.selectable]       — habilita selección de múltiples horas
   * @param {string}   [opts.highlightDate]    — YYYY-MM-DD a resaltar (vino del mes)
   * @param {Function} [opts.onSlotClick]      — (dateStr, hourStr) => void  (legacy, sin selección)
   * @param {Function} [opts.onReservationClick] (id, event) => void
   * @param {Function} [opts.onSelectionChange] (selectedArray) => void
   * @param {Function} [opts.onCommitSelection] (selectedArray) => void   — doble click sobre selección
   */
  const render = ({
    containerId,
    weekStart,
    reservations        = [],
    holidays            = [],
    editable            = false,
    selectable          = false,
    highlightDate       = null,
    onSlotClick         = null,
    onReservationClick  = null,
    onSelectionChange   = null,
    onCommitSelection   = null,
  }) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    _container     = container;
    _selectable    = Boolean(editable && selectable);
    _onSelectionCb = onSelectionChange;
    _onCommitCb    = onCommitSelection;
    _disabledKeys  = new Set();
    _partialBlocks = new Map();

    const days       = _buildDays(weekStart);
    const todayStr   = Utils.today();
    const holidayMap = new Map(holidays.map(h => [h.date, h]));
    const holidaySet = new Set(holidayMap.keys());

    // Limpiar selección de slots fuera de la semana visible (no de esta semana)
    const visibleDates = new Set(days.map(d => d.iso));
    [..._selection].forEach(key => {
      const [d] = key.split('|');
      if (!visibleDates.has(d)) _selection.delete(key);
    });

    // Indexar reservaciones por fecha (solo activas, solo esta semana)
    const resByDate = {};
    days.forEach(d => { resByDate[d.iso] = []; });
    reservations.forEach(r => {
      if (resByDate[r.date] !== undefined && r.status !== 'cancelled') {
        resByDate[r.date].push(r);
      }
    });

    // Pre-calcular slots ocupados y bloques parciales
    days.forEach(d => {
      const occ = resByDate[d.iso] || [];
      for (let h = HOUR_START; h < HOUR_END; h++) {
        const slotStart = h * 60;
        const slotEnd   = slotStart + 60;
        const key       = `${d.iso}|${String(h).padStart(2,'0')}:00`;

        // Full occupancy: reservation covers the entire hour → disable slot
        const isFullyOccupied = occ.some(r => {
          const [sh, sm] = r.startTime.split(':').map(Number);
          const [eh, em] = r.endTime.split(':').map(Number);
          const rs = sh * 60 + sm, re = eh * 60 + em;
          return rs <= slotStart && re >= slotEnd;
        });
        if (isFullyOccupied) { _disabledKeys.add(key); continue; }

        // Partial occupancy: reservation overlaps but doesn't fully cover → render strip
        const strips = [];
        occ.forEach(r => {
          const [sh, sm] = r.startTime.split(':').map(Number);
          const [eh, em] = r.endTime.split(':').map(Number);
          const rs = sh * 60 + sm, re = eh * 60 + em;
          if (rs < slotEnd && re > slotStart) {
            const top    = Math.max(rs, slotStart) - slotStart; // px from slot top
            const height = Math.min(re, slotEnd) - Math.max(rs, slotStart);
            strips.push({ top, height });
          }
        });
        if (strips.length) _partialBlocks.set(key, strips);
      }
      if (d.isWeekend || holidaySet.has(d.iso)) {
        for (let h = HOUR_START; h < HOUR_END; h++) {
          _disabledKeys.add(`${d.iso}|${String(h).padStart(2,'0')}:00`);
        }
      }
    });

    // Purgar selecciones que ahora están bloqueadas (ocupadas o deshabilitadas)
    [..._selection].forEach(key => {
      if (_disabledKeys.has(key)) _selection.delete(key);
    });

    container.innerHTML = `
      <div class="cal-wk" role="grid" aria-label="Vista semanal">
        ${_buildHeader(days, todayStr, holidayMap, highlightDate)}
        <div class="cal-wk__body">
          ${_buildGutter()}
          ${days.map(d => _buildDayCol(d, resByDate[d.iso] || [], holidayMap, editable, todayStr, highlightDate)).join('')}
        </div>
      </div>`;

    _attachEvents(container, editable, onSlotClick, onReservationClick);
    _applySelectionStyles();
    _emitSelectionChange();
  };

  /* ── CONSTRUIR 7 DÍAS ── */
  const _buildDays = (weekStart) => {
    const abbrs = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    return abbrs.map((abbr, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return {
        date:      d,
        iso:       Utils.dateToISO(d),
        day:       d.getDate(),
        abbr,
        isWeekend: i >= 5,
      };
    });
  };

  /* ── HEADER ── */
  const _buildHeader = (days, todayStr, holidayMap, highlightDate) => {
    const cells = days.map(d => {
      const isToday     = d.iso === todayStr;
      const isHighlight = d.iso === highlightDate;
      const hol         = holidayMap.get(d.iso);
      const cls = [
        'cal-wk__head-cell',
        isToday                       ? 'is-today'     : '',
        isHighlight                   ? 'is-highlight' : '',
        hol?.type === 'holiday'       ? 'is-holiday'   : '',
        hol?.type === 'closure'       ? 'is-closure'   : '',
        d.isWeekend                   ? 'is-weekend'   : '',
      ].filter(Boolean).join(' ');

      const holLabel = hol
        ? `<span class="cal-wk__holiday-label cal-wk__holiday-label--${hol.type}">${Utils.escapeHTML(Utils.truncate(hol.name, 14))}</span>`
        : '';

      return `
        <div class="${cls}" role="columnheader" aria-label="${d.abbr} ${d.day}">
          <span class="cal-wk__dow">${d.abbr}</span>
          <span class="cal-wk__daynum${isToday ? ' is-today' : ''}">${d.day}</span>
          ${holLabel}
        </div>`;
    }).join('');

    return `
      <div class="cal-wk__header" role="row">
        <div class="cal-wk__gutter-head" aria-hidden="true"></div>
        ${cells}
      </div>`;
  };

  /* ── GUTTER DE HORAS ── */
  const _buildGutter = () => {
    let labels = '';
    for (let h = HOUR_START; h <= HOUR_END; h++) {
      labels += `<span class="cal-wk__hour-label"
                       style="top:${(h - HOUR_START) * SLOT_H}px"
                       aria-hidden="true">
                   ${String(h).padStart(2, '0')}:00
                 </span>`;
    }
    return `<div class="cal-wk__gutter" style="height:${TOTAL_H}px;" aria-hidden="true">${labels}</div>`;
  };

  /* ── COLUMNA DE DÍA ── */
  const _buildDayCol = (d, reservations, holidayMap, editable, todayStr, highlightDate) => {
    const hol        = holidayMap.get(d.iso);
    const isDisabled = d.isWeekend || !!hol;
    const cls = [
      'cal-wk__day-col',
      d.iso === todayStr      ? 'is-today'     : '',
      d.iso === highlightDate ? 'is-highlight' : '',
      isDisabled              ? 'is-disabled'  : '',
      hol?.type === 'holiday' ? 'is-holiday'   : '',
      hol?.type === 'closure' ? 'is-closure'   : '',
    ].filter(Boolean).join(' ');

    let slots = '';
    for (let h = HOUR_START; h < HOUR_END; h++) {
      const timeStr = `${String(h).padStart(2, '0')}:00`;
      const key     = `${d.iso}|${timeStr}`;
      const isOccupied = _disabledKeys.has(key) && !isDisabled;
      const canClick = editable && !isDisabled && !isOccupied;

      const strips = _partialBlocks.get(key) || [];
      const hasPartial = strips.length > 0;

      const slotCls = [
        'cal-wk__slot',
        canClick    ? 'is-clickable' : '',
        isOccupied  ? 'is-occupied'  : '',
        hasPartial  ? 'has-partial'  : '',
      ].filter(Boolean).join(' ');

      // Inline background-image gradient paints the occupied sub-range in red.
      // Using background-image (not background shorthand) lets background-color
      // from .is-selected / hover rules coexist on the same element.
      let partialBg = '';
      if (hasPartial) {
        const stops = [];
        strips.forEach(s => {
          const s0 = (s.top / SLOT_H * 100).toFixed(1);
          const s1 = ((s.top + s.height) / SLOT_H * 100).toFixed(1);
          stops.push(`transparent ${s0}%`);
          stops.push(`rgba(220,38,38,0.25) ${s0}%`);
          stops.push(`rgba(220,38,38,0.25) ${s1}%`);
          stops.push(`transparent ${s1}%`);
        });
        partialBg = `background-image:linear-gradient(to bottom,${stops.join(',')});`;
      }

      slots += `<div class="${slotCls}"
                     style="top:${(h - HOUR_START) * SLOT_H}px;height:${SLOT_H}px;${partialBg}"
                     data-date="${d.iso}" data-hour="${timeStr}"
                     ${canClick
                       ? `role="button" tabindex="0" aria-label="Reservar el ${d.iso} a las ${timeStr}"`
                       : 'aria-hidden="true"'}
               ></div>`;
    }

    const blocks = reservations.map(r => _buildEvent(r)).join('');

    return `<div class="${cls}" style="height:${TOTAL_H}px;" role="gridcell" data-date="${d.iso}">${slots}${blocks}</div>`;
  };

  /* ── BLOQUE DE EVENTO ── */
  const _buildEvent = (r) => {
    const [sh, sm] = r.startTime.split(':').map(Number);
    const [eh, em] = r.endTime.split(':').map(Number);

    const startMin = Math.max(0, (sh - HOUR_START) * 60 + sm);
    const endMin   = Math.min(TOTAL_H, (eh - HOUR_START) * 60 + em);
    const height   = Math.max(22, endMin - startMin);

    const cls = [
      'cal-wk__event cal-reservation',
      r.isRecurring ? 'is-recurring' : '',
    ].filter(Boolean).join(' ');

    const showTime = endMin - startMin >= 60;
    return `
      <div class="${cls}"
           style="top:${startMin}px;height:${height}px;"
           data-id="${r.id}"
           role="button" tabindex="0"
           aria-label="${Utils.escapeHTML(r.responsible)}, ${r.startTime}–${r.endTime}">
        ${showTime ? `<span class="cal-wk__ev-time">${r.startTime}–${r.endTime}</span>` : ''}
        <span class="cal-wk__ev-name">${Utils.escapeHTML(Utils.truncate(r.responsible, 22))}</span>
      </div>`;
  };

  /* ════════════════════════════════════════
     EVENT WIRING
     ════════════════════════════════════════ */
  const _attachEvents = (container, editable, onSlotClick, onReservationClick) => {
    // Eventos: bloques de reservación
    container.querySelectorAll('.cal-wk__event').forEach(el => {
      const fire = (e) => { e.stopPropagation(); onReservationClick?.(el.dataset.id, e); };
      el.addEventListener('click',   fire);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e); }
      });
    });

    if (!editable) return;

    // Modo selección (multi)
    if (_selectable) {
      _wireSelection(container);
      return;
    }

    // Legacy: click simple en slot dispara onSlotClick
    if (onSlotClick) {
      container.querySelectorAll('.cal-wk__slot.is-clickable').forEach(el => {
        const fire = () => onSlotClick(el.dataset.date, el.dataset.hour);
        el.addEventListener('click',   fire);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(); }
        });
      });
    }
  };

  /* ── SELECCIÓN MULTI-HORA ──
     Idempotente: evita registrar listeners duplicados al re-renderizar.
   */
  let _selectionWired = false;
  const _wireSelection = (container) => {
    if (_selectionWired) return;
    container.addEventListener('mousedown', _onMouseDown);
    container.addEventListener('mousemove', _onMouseMove);
    document.addEventListener('mouseup',    _onMouseUp);
    container.addEventListener('keydown',   _onKeyDown);
    container.addEventListener('dblclick',  _onDoubleClick);
    _selectionWired = true;
  };

  const _slotFromEvent = (e) => {
    const el = e.target?.closest?.('.cal-wk__slot.is-clickable');
    if (!el) return null;
    return { el, dateIso: el.dataset.date, hour: el.dataset.hour };
  };

  const _onMouseDown = (e) => {
    if (e.button !== 0) return;
    const slot = _slotFromEvent(e);
    if (!slot) return;
    e.preventDefault();

    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (!additive) _selection.clear();

    _dragAnchor = { ...slot, additive };
    _dragMoved  = false;

    _toggleKey(`${slot.dateIso}|${slot.hour}`, true);
    _applySelectionStyles();
    _emitSelectionChange();
  };

  const _onMouseMove = (e) => {
    if (!_dragAnchor) return;
    const slot = _slotFromEvent(e);
    if (!slot) return;

    // Solo arrastrar dentro de la misma columna (mismo día)
    if (slot.dateIso !== _dragAnchor.dateIso) return;

    _dragMoved = true;
    _selectRange(_dragAnchor, slot);
    _applySelectionStyles();
    _emitSelectionChange();
  };

  const _onMouseUp = () => {
    _dragAnchor = null;
    _dragMoved  = false;
  };

  const _onKeyDown = (e) => {
    const target = e.target?.closest?.('.cal-wk__slot.is-clickable');
    if (!target) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      const key = `${target.dataset.date}|${target.dataset.hour}`;
      const additive = e.ctrlKey || e.metaKey;
      if (!additive) _selection.clear();
      _toggleKey(key, true);
      _applySelectionStyles();
      _emitSelectionChange();
    } else if (e.key === 'Escape') {
      clearSelection();
    }
  };

  const _onDoubleClick = (e) => {
    const slot = _slotFromEvent(e);
    if (!slot) return;
    if (_selection.size === 0) {
      _selection.add(`${slot.dateIso}|${slot.hour}`);
    }
    _applySelectionStyles();
    _onCommitCb?.(getSelection());
  };

  const _selectRange = (anchor, current) => {
    if (!_dragAnchor.additive) {
      // Reiniciar selección con el rango actual desde el ancla
      _selection.clear();
    }
    const aHour = parseInt(anchor.hour.slice(0, 2), 10);
    const cHour = parseInt(current.hour.slice(0, 2), 10);
    const lo = Math.min(aHour, cHour);
    const hi = Math.max(aHour, cHour);
    for (let h = lo; h <= hi; h++) {
      const key = `${anchor.dateIso}|${String(h).padStart(2,'0')}:00`;
      if (!_disabledKeys.has(key)) _selection.add(key);
    }
  };

  const _toggleKey = (key, forceAdd = false) => {
    if (_disabledKeys.has(key)) return;
    if (_selection.has(key) && !forceAdd) _selection.delete(key);
    else _selection.add(key);
  };

  const _applySelectionStyles = () => {
    if (!_container) return;
    _container.querySelectorAll('.cal-wk__slot').forEach(el => {
      const key = `${el.dataset.date}|${el.dataset.hour}`;
      el.classList.toggle('is-selected', _selection.has(key));
    });
  };

  const _emitSelectionChange = () => {
    _onSelectionCb?.(getSelection());
  };

  /* ════════════════════════════════════════
     PUBLIC API DE SELECCIÓN
     ════════════════════════════════════════ */

  /** Devuelve la selección como array ordenado de {date, hour} */
  const getSelection = () =>
    [..._selection]
      .map(key => {
        const [date, hour] = key.split('|');
        return { date, hour };
      })
      .sort((a, b) => (a.date + a.hour).localeCompare(b.date + b.hour));

  /** Devuelve la selección agrupada en intervalos contiguos (mismo día, horas consecutivas) */
  const getIntervals = () => {
    const sorted = getSelection();
    const intervals = [];
    let cur = null;
    for (const s of sorted) {
      const h = parseInt(s.hour.slice(0, 2), 10);
      if (cur && cur.date === s.date && h === cur.endHour) {
        cur.endHour = h + 1;
      } else {
        if (cur) intervals.push(cur);
        cur = { date: s.date, startHour: h, endHour: h + 1 };
      }
    }
    if (cur) intervals.push(cur);
    return intervals.map(iv => ({
      date:      iv.date,
      startTime: `${String(iv.startHour).padStart(2,'0')}:00`,
      endTime:   `${String(iv.endHour).padStart(2,'0')}:00`,
    }));
  };

  const clearSelection = () => {
    _selection.clear();
    _applySelectionStyles();
    _emitSelectionChange();
  };

  const setSelection = (arr) => {
    _selection.clear();
    (arr || []).forEach(({ date, hour }) => {
      const key = `${date}|${hour}`;
      if (!_disabledKeys.has(key)) _selection.add(key);
    });
    _applySelectionStyles();
    _emitSelectionChange();
  };

  return {
    render,
    getSelection,
    getIntervals,
    clearSelection,
    setSelection,
  };
})();
