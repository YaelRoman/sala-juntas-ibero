/* ============================================================
   CALENDAR-WEEK.JS — Componente de vista semanal
   HU-04 (disponibilidad), HU-06 (responsable), HU-07 (navegación)
   Soporta selección de múltiples horas (click, arrastre, Ctrl+click, Shift+click para rango)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const CalendarWeek = (() => {

  const HOUR_START = 7;
  const HOUR_END   = 20;
  const SLOT_H     = 30;                              // px por slot de 30 min
  const TOTAL_H    = (HOUR_END - HOUR_START) * 60;   // 780px (1px = 1 min)

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
  let _lastClickedSlot = null;       // {dateIso, hour} para Shift+Click

  /* ── ESTADO INTERNO DE ARRASTRE DE BLOQUES ── */
  let _reservationMap     = new Map(); // id -> reservation (para drag-to-reschedule)
  let _onBlockDropCb      = null;
  let _blockDrag          = null;      // {id, reservation, origEl, startX, startY, active, ghostEl, dropDate, dropHour, dropSlotEl}
  let _blockDragWired     = false;
  let _blockDragWasActive = false;

  /* ── ESTADO INTERNO DE REDIMENSIONADO ── */
  let _onBlockResizeCb = null;
  let _resizeDrag      = null;   // {id, reservation, origEl, startY, origEndMin, active, newEndMin}
  let _resizeWired     = false;

  /* ── ESTADO INTERNO DE AUTO-SCROLL ── */
  let _autoScrollRaf   = null;
  let _autoScrollDir   = 0;      // -1 arriba, 0 ninguno, 1 abajo
  const SCROLL_EDGE    = 50;     // px desde el borde para triggear scroll
  const SCROLL_SPEED   = 8;      // px por frame

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
    onBlockDrop         = null,
    onBlockResize       = null,
  }) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    _container      = container;
    _selectable     = Boolean(editable && selectable);
    _onSelectionCb  = onSelectionChange;
    _onCommitCb     = onCommitSelection;
    _onBlockDropCb   = onBlockDrop;
    _onBlockResizeCb = onBlockResize;
    _disabledKeys    = new Set();
    _partialBlocks  = new Map();
    _reservationMap = new Map();
    _lastClickedSlot = null;
    reservations.forEach(r => _reservationMap.set(r.id, r));

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
        for (let m = 0; m < 60; m += 30) {
          const slotStart = h * 60 + m;
          const slotEnd   = slotStart + 30;
          const timeStr   = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
          const key       = `${d.iso}|${timeStr}`;

          // Full occupancy: reservation covers the entire slot → disable slot
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
      }
      if (d.isWeekend || holidaySet.has(d.iso)) {
        for (let h = HOUR_START; h < HOUR_END; h++) {
          _disabledKeys.add(`${d.iso}|${String(h).padStart(2,'0')}:00`);
          _disabledKeys.add(`${d.iso}|${String(h).padStart(2,'0')}:30`);
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
                       style="top:${(h - HOUR_START) * 60}px"
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
      for (let m = 0; m < 60; m += 30) {
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2,'0')}`;
        const topPx   = (h - HOUR_START) * 60 + m;
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
                       style="top:${topPx}px;height:${SLOT_H}px;${partialBg}"
                       data-date="${d.iso}" data-hour="${timeStr}"
                       ${canClick
                         ? `role="button" tabindex="0" aria-label="Reservar el ${d.iso} a las ${timeStr}"`
                         : 'aria-hidden="true"'}
                 ></div>`;
      }
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
        <div class="cal-wk__event-resize-handle" aria-hidden="true"></div>
      </div>`;
  };

  /* ════════════════════════════════════════
     EVENT WIRING
     ════════════════════════════════════════ */
  const _attachEvents = (container, editable, onSlotClick, onReservationClick) => {
    // Eventos: bloques de reservación
    container.querySelectorAll('.cal-wk__event').forEach(el => {
      const fire = (e) => {
        if (_blockDragWasActive) { _blockDragWasActive = false; return; }
        e.stopPropagation();
        onReservationClick?.(el.dataset.id, e);
      };
      el.addEventListener('click',   fire);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fire(e); }
      });
    });

    if (editable && _onBlockResizeCb) _wireBlockResize(container);
    if (editable && _onBlockDropCb)   _wireBlockDrag(container);

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

  /* ── ARRASTRE DE BLOQUES DE RESERVACIÓN (drag-to-reschedule) ── */

  const _wireBlockDrag = (container) => {
    if (_blockDragWired) return;
    container.addEventListener('pointerdown', _onBlockPointerDown);
    _blockDragWired = true;
  };

  /* ── REDIMENSIONADO DE BLOQUES (arrastrar borde inferior) ── */

  const _wireBlockResize = (container) => {
    if (_resizeWired) return;
    container.addEventListener('pointerdown', _onResizePointerDown);
    _resizeWired = true;
  };

  const _onResizePointerDown = (e) => {
    if (e.button !== 0) return;
    if (!e.target.closest('.cal-wk__event-resize-handle')) return;
    e.stopPropagation();

    const el = e.target.closest('.cal-wk__event');
    if (!el) return;
    const reservation = _reservationMap.get(el.dataset.id);
    if (!reservation) return;

    const [eh, em] = reservation.endTime.split(':').map(Number);
    _resizeDrag = {
      id:         el.dataset.id,
      reservation,
      origEl:     el,
      startY:     e.clientY,
      origEndMin: eh * 60 + em,
      active:     false,
      newEndMin:  eh * 60 + em,
    };

    document.addEventListener('pointermove', _onResizePointerMove);
    document.addEventListener('pointerup',   _onResizePointerUp);
  };

  const _onResizePointerMove = (e) => {
    if (!_resizeDrag) return;

    const dy = e.clientY - _resizeDrag.startY;
    if (!_resizeDrag.active) {
      if (Math.abs(dy) < 5) return;
      _resizeDrag.active = true;
      document.body.style.userSelect = 'none';
      document.body.style.cursor     = 'ns-resize';
    }

    // Snap to 30-min grid (SLOT_H px = 30 min)
    const deltaMin  = Math.round(dy / SLOT_H) * 30;
    const [sh, sm]  = _resizeDrag.reservation.startTime.split(':').map(Number);
    const minEndMin = sh * 60 + sm + 30;                       // at least 30 min
    const newEndMin = Math.max(minEndMin, Math.min(HOUR_END * 60, _resizeDrag.origEndMin + deltaMin));
    _resizeDrag.newEndMin = newEndMin;

    // Update block height live
    const startPx = (sh - HOUR_START) * 60 + sm;
    const endPx   = newEndMin - HOUR_START * 60;
    _resizeDrag.origEl.style.height = `${Math.max(SLOT_H, endPx - startPx)}px`;

    // Update time label live
    const timeEl = _resizeDrag.origEl.querySelector('.cal-wk__ev-time');
    if (timeEl) {
      const newEndH = Math.floor(newEndMin / 60);
      const newEndM = newEndMin % 60;
      timeEl.textContent = `${_resizeDrag.reservation.startTime}–${String(newEndH).padStart(2,'0')}:${String(newEndM).padStart(2,'0')}`;
    }

    const scrollDir = _checkAutoScroll(e.clientY);
    _startAutoScroll(scrollDir);
  };

  const _onResizePointerUp = (e) => {
    document.removeEventListener('pointermove', _onResizePointerMove);
    document.removeEventListener('pointerup',   _onResizePointerUp);
    _stopAutoScroll();

    if (!_resizeDrag) return;
    const { active, id, reservation, newEndMin, origEl } = _resizeDrag;
    _resizeDrag = null;

    document.body.style.userSelect = '';
    document.body.style.cursor     = '';

    if (!active) return;

    origEl.style.height = ''; // re-render will set the definitive height

    const newEndH   = Math.floor(newEndMin / 60);
    const newEndM   = newEndMin % 60;
    const newEndStr = `${String(newEndH).padStart(2,'0')}:${String(newEndM).padStart(2,'0')}`;

    if (newEndStr !== reservation.endTime) {
      _onBlockResizeCb?.(id, reservation, newEndStr, e.clientX, e.clientY);
    }
  };

  const _getColAtPoint = (x, y) => {
    // .cal-wk__event--ghost has pointer-events:none in CSS, so this skips it
    const el = document.elementFromPoint(x, y);
    return el?.closest('.cal-wk__day-col') ?? null;
  };

  const _onBlockPointerDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.cal-wk__event-resize-handle')) return; // handled by resize
    const el = e.target.closest('.cal-wk__event');
    if (!el) return;
    e.stopPropagation();

    _blockDragWasActive = false; // clear any stale flag from previous drag
    const reservation = _reservationMap.get(el.dataset.id);
    if (!reservation) return;

    _blockDrag = {
      id: el.dataset.id,
      reservation,
      origEl:      el,
      startX:      e.clientX,
      startY:      e.clientY,
      active:      false,
      ghostEl:     null,
      dropDate:    null,
      dropHour:    null,
      dropMin:     null,
      dropSlotEl:  null,
    };

    document.addEventListener('pointermove', _onBlockPointerMove);
    document.addEventListener('pointerup',   _onBlockPointerUp);
  };

  const _onBlockPointerMove = (e) => {
    if (!_blockDrag) return;

    const dx = e.clientX - _blockDrag.startX;
    const dy = e.clientY - _blockDrag.startY;

    if (!_blockDrag.active) {
      if (Math.hypot(dx, dy) < 5) return;

      _blockDrag.active = true;
      _blockDrag.origEl.classList.add('is-dragging');
      document.body.style.userSelect = 'none';

      const ghost = _blockDrag.origEl.cloneNode(true);
      ghost.className = 'cal-wk__event cal-reservation cal-wk__event--ghost';
      ghost.style.width  = `${_blockDrag.origEl.offsetWidth}px`;
      ghost.style.height = `${_blockDrag.origEl.offsetHeight}px`;
      document.body.appendChild(ghost);
      _blockDrag.ghostEl = ghost;
    }

    // Move ghost to follow pointer
    const g = _blockDrag.ghostEl;
    g.style.transform = `translate3d(${e.clientX - _blockDrag.origEl.offsetWidth / 2}px, ${e.clientY - 20}px, 0)`;

    // Find column under cursor
    const col = _getColAtPoint(e.clientX, e.clientY);

    // Clear previous slot highlight
    if (_blockDrag.dropSlotEl) {
      _blockDrag.dropSlotEl.classList.remove('is-drop-target');
      _blockDrag.dropSlotEl = null;
    }
    _blockDrag.dropDate = null;
    _blockDrag.dropHour = null;

    _startAutoScroll(_checkAutoScroll(e.clientY));

    if (!col ||
        col.classList.contains('is-disabled') ||
        col.classList.contains('is-holiday') ||
        col.classList.contains('is-closure')) return;

    const rect      = col.getBoundingClientRect();
    const slotIndex = Math.floor((e.clientY - rect.top) / SLOT_H);
    const slotMin   = HOUR_START * 60 + slotIndex * 30;
    const dropHour  = Math.floor(slotMin / 60);
    const dropMin   = slotMin % 60;
    if (dropHour < HOUR_START || dropHour >= HOUR_END) return;

    const timeStr = `${String(dropHour).padStart(2, '0')}:${String(dropMin).padStart(2, '0')}`;
    const slotEl  = col.querySelector(`[data-hour="${timeStr}"]`);
    if (slotEl) {
      slotEl.classList.add('is-drop-target');
      _blockDrag.dropSlotEl = slotEl;
    }
    _blockDrag.dropDate = col.dataset.date;
    _blockDrag.dropHour = dropHour;
    _blockDrag.dropMin  = dropMin;
  };

  const _onBlockPointerUp = (e) => {
    document.removeEventListener('pointermove', _onBlockPointerMove);
    document.removeEventListener('pointerup',   _onBlockPointerUp);

    if (!_blockDrag) return;

    const { active, origEl, ghostEl, dropSlotEl, dropDate, dropHour, dropMin, id, reservation } = _blockDrag;

    origEl.classList.remove('is-dragging');
    ghostEl?.remove();
    dropSlotEl?.classList.remove('is-drop-target');
    document.body.style.userSelect = '';

    _blockDragWasActive = active;

    if (active && dropDate !== null && dropHour !== null) {
      const [sh, sm] = reservation.startTime.split(':').map(Number);
      const [eh, em] = reservation.endTime.split(':').map(Number);
      const durationMin = (eh * 60 + em) - (sh * 60 + sm);

      const newEndMin = dropHour * 60 + (dropMin ?? 0) + durationMin;

      if (newEndMin <= HOUR_END * 60) {
        const newStartTime = `${String(dropHour).padStart(2, '0')}:${String(dropMin ?? 0).padStart(2, '0')}`;
        const newEndH      = Math.floor(newEndMin / 60);
        const newEndM      = newEndMin % 60;
        const newEndTime   = `${String(newEndH).padStart(2, '0')}:${String(newEndM).padStart(2, '0')}`;
        _onBlockDropCb?.(id, reservation, { date: dropDate, startTime: newStartTime, endTime: newEndTime }, e.clientX, e.clientY);
      }
      // If overflow past HOUR_END, drop is silently cancelled
    }

    _stopAutoScroll();
    _blockDrag = null;
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
    container.addEventListener('wheel',     _onWheel, { passive: false });
    _selectionWired = true;
  };

  const _onWheel = (e) => {
    if (!_container) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    _container.scrollTop += dir * 40;
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

    const isShift = e.shiftKey;
    const isCtrl = e.ctrlKey || e.metaKey;
    const additive = isCtrl || isShift;

    // Shift+Click on same day with prior selection: select range
    if (isShift && !isCtrl && _lastClickedSlot && _lastClickedSlot.dateIso === slot.dateIso) {
      _dragAnchor = { ...slot, additive: false };
      _selectRange(_lastClickedSlot, slot);
      _applySelectionStyles();
      _emitSelectionChange();
      _dragMoved = false;
      _lastClickedSlot = slot;
      return;
    }

    if (!additive) _selection.clear();

    _dragAnchor = { ...slot, additive };
    _dragMoved  = false;

    _toggleKey(`${slot.dateIso}|${slot.hour}`, true);
    _applySelectionStyles();
    _emitSelectionChange();

    _lastClickedSlot = slot;
  };

  const _onMouseMove = (e) => {
    if (!_dragAnchor) return;

    _startAutoScroll(_checkAutoScroll(e.clientY));

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
    _stopAutoScroll();
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
    const _toMin  = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const _toTime = (min) => `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
    const lo = Math.min(_toMin(anchor.hour), _toMin(current.hour));
    const hi = Math.max(_toMin(anchor.hour), _toMin(current.hour));
    for (let t = lo; t <= hi; t += 30) {
      const key = `${anchor.dateIso}|${_toTime(t)}`;
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

  /* ── AUTO-SCROLL HELPERS ── */
  const _checkAutoScroll = (clientY) => {
    if (!_container) return 0;
    const rect = _container.getBoundingClientRect();
    if (clientY < rect.top + SCROLL_EDGE) return -1;
    if (clientY > rect.bottom - SCROLL_EDGE) return 1;
    return 0;
  };

  const _startAutoScroll = (dir) => {
    if (_autoScrollDir === dir) return;
    _autoScrollDir = dir;
    _stopAutoScroll();
    if (dir === 0) return;

    const doScroll = () => {
      if (!_container) return;
      _container.scrollTop += dir * SCROLL_SPEED;
      _autoScrollRaf = requestAnimationFrame(doScroll);
    };
    _autoScrollRaf = requestAnimationFrame(doScroll);
  };

  const _stopAutoScroll = () => {
    if (_autoScrollRaf) cancelAnimationFrame(_autoScrollRaf);
    _autoScrollRaf = null;
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

  /** Devuelve la selección agrupada en intervalos contiguos (mismo día, bloques de 30 min consecutivos) */
  const getIntervals = () => {
    const sorted = getSelection();
    const intervals = [];
    let cur = null;
    for (const s of sorted) {
      const [h, m] = s.hour.split(':').map(Number);
      const startMin = h * 60 + m;
      const endMin   = startMin + 30;
      if (cur && cur.date === s.date && startMin === cur.endMin) {
        cur.endMin = endMin;
      } else {
        if (cur) intervals.push(cur);
        cur = { date: s.date, startMin, endMin };
      }
    }
    if (cur) intervals.push(cur);
    const _fmt = (min) => `${String(Math.floor(min/60)).padStart(2,'0')}:${String(min%60).padStart(2,'0')}`;
    return intervals.map(iv => ({
      date:      iv.date,
      startTime: _fmt(iv.startMin),
      endTime:   _fmt(iv.endMin),
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
