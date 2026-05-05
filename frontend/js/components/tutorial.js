/* ============================================================
   TUTORIAL.JS — Tutorial interactivo con spotlight
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const Tutorial = (() => {

  const STORAGE_KEY = 'sjibero_tutorial_v1';
  const PAD         = 10;   // px padding around spotlight
  const GAP         = 14;   // px gap between spotlight and tooltip

  /* ── SVG icons ─────────────────────────────────────────── */
  const _I = {
    welcome:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
    stats:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
    calendar: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    form:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
    week:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>`,
    move:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>`,
    copy:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
    upcoming: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    nav:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
    done:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  };

  /* ── Steps ─────────────────────────────────────────────── */
  const STEPS = [
    /* 0 — Welcome */
    {
      target:   null,
      position: 'center',
      icon:     _I.welcome,
      title:    'Bienvenido al sistema de reservaciones',
      body:     'Este es el sistema de reservaciones de la Sala de Juntas de la Universidad Iberoamericana. En los siguientes pasos te mostramos todo lo que necesitas saber para empezar.',
    },

    /* 1 — Stats */
    {
      target:   '.stats-grid',
      position: 'bottom',
      icon:     _I.stats,
      title:    'Resumen de actividad',
      body:     'Un vistazo rápido al estado actual: total de reservaciones del mes, activas en los próximos 7 días, las de hoy y las series recurrentes en curso.',
    },

    /* 2 — Monthly: click to reserve */
    {
      target:   '#calendar-body',
      position: 'top',
      icon:     _I.calendar,
      title:    'Crear una reservación — vista mensual',
      body:     `Haz clic en cualquier día del calendario para abrir el formulario de reservación. Puedes seleccionar múltiples días a la vez manteniendo <kbd>Ctrl</kbd> y haciendo clic.
<div class="tut__tip">El formulario te pide: responsable, área, horario de inicio y fin, observaciones, y si la reservación es recurrente (diaria, semanal o mensual).</div>`,
    },

    /* 3 — Weekly view switch + drag-to-select */
    {
      target:   '.calendar-widget__view-toggle',
      position: 'bottom',
      icon:     _I.week,
      title:    'Vista semanal — selección de horas',
      onEnter:  () => document.getElementById('view-week')?.click(),
      body:     `Cambia a <strong>Semana</strong> para ver el horario hora a hora. En esta vista puedes:
<ul class="tut__list">
  <li>Arrastrar sobre las celdas de tiempo para seleccionar un rango de horas</li>
  <li>Mantener <kbd>Shift</kbd> y hacer clic para ampliar la selección</li>
  <li>Hacer clic directo en una celda para una sola hora</li>
</ul>
Una barra aparece en la parte superior del calendario con el botón <strong>Reservar selección</strong>.`,
    },

    /* 4 — Move (drag-to-reschedule) */
    {
      target:   '#calendar-body',
      position: 'top',
      icon:     _I.move,
      title:    'Mover reservaciones',
      body:     `En vista semanal, arrastra cualquier bloque de reservación a un nuevo día u horario. Una ventana de confirmación aparece antes de guardar.
<div class="tut__tip">Para reservaciones recurrentes puedes elegir mover <strong>solo esta instancia</strong> o <strong>toda la serie</strong>. El sistema verifica automáticamente si el destino está disponible.</div>`,
    },

    /* 5 — Resize */
    {
      target:   '#calendar-body',
      position: 'top',
      icon:     _I.move,
      title:    'Ajustar duración',
      body:     `Arrastra el <strong>borde inferior</strong> de cualquier bloque hacia arriba o abajo para cambiar su hora de fin sin tener que editar el formulario.
<div class="tut__tip">También funciona en reservaciones recurrentes: elige si ajustar solo esta instancia o toda la serie.</div>`,
    },

    /* 6 — Right-click on block: copy, cut */
    {
      target:   '#calendar-body',
      position: 'top',
      icon:     _I.copy,
      title:    'Copiar, cortar y pegar',
      body:     `Haz <strong>clic derecho</strong> sobre un bloque de reservación para ver las opciones:
<ul class="tut__list">
  <li><strong>Copiar</strong> — duplica la reservación en el horario que elijas</li>
  <li><strong>Cortar</strong> — la marca como "en espera"; clic derecho en una celda libre para moverla</li>
</ul>
También puedes usar el teclado (pasa el cursor sobre el bloque primero):
<div class="tut__shortcuts">
  <span><kbd>Ctrl</kbd>+<kbd>C</kbd><span class="tut__shortcut-label">Copiar</span></span>
  <span><kbd>Ctrl</kbd>+<kbd>X</kbd><span class="tut__shortcut-label">Cortar</span></span>
  <span><kbd>Ctrl</kbd>+<kbd>V</kbd><span class="tut__shortcut-label">Pegar en el slot bajo el cursor</span></span>
</div>`,
    },

    /* 7 — Right-click on empty cell */
    {
      target:   '#calendar-body',
      position: 'top',
      icon:     _I.calendar,
      title:    'Menú contextual de celda',
      body:     `Haz <strong>clic derecho</strong> sobre una celda vacía del calendario semanal para:
<ul class="tut__list">
  <li>Pegar una reservación copiada o cortada en ese horario exacto</li>
  <li>Marcar ese día como <strong>festivo</strong> o <strong>cierre institucional</strong></li>
  <li>Volver rápidamente a la vista mensual del mes mostrado</li>
</ul>`,
    },

    /* 8 — Upcoming panel */
    {
      target:   '.upcoming-panel',
      position: 'left',
      icon:     _I.upcoming,
      title:    'Próximas reservaciones',
      body:     'Lista cronológica de las reservaciones más cercanas. Haz clic en cualquiera para ir a esa fecha en el calendario y ver el detalle completo con opciones de edición.',
    },

    /* 9 — Sidebar */
    {
      target:   '#sidebar',
      position: 'right',
      icon:     _I.nav,
      title:    'Menú de navegación',
      body:     `Desde el menú lateral accedes a:
<ul class="tut__list">
  <li><strong>Historial</strong> — todas las reservaciones pasadas y canceladas</li>
  <li><strong>Asistente IA</strong> — captura reservaciones con lenguaje natural</li>
  <li><strong>Administración</strong> — gestión de usuarios y solicitudes de cambio</li>
</ul>`,
    },

    /* 10 — Done */
    {
      target:   null,
      position: 'center',
      icon:     _I.done,
      title:    '¡Todo listo para empezar!',
      body:     'Ya conoces las funciones principales del sistema. Puedes repetir este tutorial en cualquier momento haciendo clic en el botón <strong>?</strong> de la barra superior.',
    },
  ];

  /* ── State ─────────────────────────────────────────────── */
  let _step      = 0;
  let _active    = false;
  let _blocker   = null;
  let _spotlight = null;
  let _tooltip   = null;
  let _onResize  = null;
  let _onKey     = null;

  /* ════════════════════════════════════════
     PUBLIC API
     ════════════════════════════════════════ */

  const start = () => {
    if (_active) return;
    _active = true;
    _step   = 0;
    _mount();
    _showStep(0);
  };

  const stop = () => {
    if (!_active) return;
    _active = false;
    _blocker?.remove();
    _spotlight?.remove();
    _tooltip?.remove();
    _blocker = _spotlight = _tooltip = null;
    if (_onResize) window.removeEventListener('resize', _onResize);
    if (_onKey)    document.removeEventListener('keydown', _onKey);
    localStorage.setItem(STORAGE_KEY, '1');
  };

  /** Show automatically on first ever visit. */
  const autoStart = () => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setTimeout(start, 900);
    }
  };

  /* ════════════════════════════════════════
     DOM SETUP
     ════════════════════════════════════════ */

  const _mount = () => {
    _blocker = Object.assign(document.createElement('div'), { id: 'tutorial-blocker' });
    document.body.appendChild(_blocker);

    _spotlight = Object.assign(document.createElement('div'), { id: 'tutorial-spotlight' });
    _spotlight.classList.add('is-hidden');
    document.body.appendChild(_spotlight);

    _tooltip = Object.assign(document.createElement('div'), { id: 'tutorial-tooltip' });
    document.body.appendChild(_tooltip);

    _onResize = () => { if (_active) _showStep(_step); };
    window.addEventListener('resize', _onResize);

    _onKey = (e) => {
      if (!_active) return;
      if (e.key === 'Escape')                          stop();
      if (e.key === 'ArrowRight' || e.key === 'Enter') _next();
      if (e.key === 'ArrowLeft')                       _prev();
    };
    document.addEventListener('keydown', _onKey);
  };

  /* ════════════════════════════════════════
     STEP RENDERING
     ════════════════════════════════════════ */

  const _showStep = (idx) => {
    const step    = STEPS[idx];
    const isFirst = idx === 0;
    const isLast  = idx === STEPS.length - 1;

    // Run optional step hook (e.g. switch to weekly view)
    step.onEnter?.();

    /* ── Spotlight ── */
    const targetEl = step.target ? document.querySelector(step.target) : null;
    const visible  = _isVisible(targetEl);

    if (visible) {
      const r = targetEl.getBoundingClientRect();
      _spotlight.classList.remove('is-hidden');
      Object.assign(_spotlight.style, {
        top:    `${r.top    - PAD}px`,
        left:   `${r.left   - PAD}px`,
        width:  `${r.width  + PAD * 2}px`,
        height: `${r.height + PAD * 2}px`,
      });
    } else {
      _spotlight.classList.add('is-hidden');
      Object.assign(_spotlight.style, { top: '50%', left: '50%', width: '0', height: '0' });
    }

    /* ── Tooltip ── */
    const isCenter = step.position === 'center' || !visible;
    _tooltip.className = isCenter ? 'is-centered' : '';

    // Replay animation on each step change
    _tooltip.style.animation = 'none';
    void _tooltip.offsetWidth;
    _tooltip.style.animation = '';

    const dots = STEPS.map((_, i) => {
      const cls = i === idx ? 'is-active' : (i < idx ? 'is-done' : '');
      return `<span class="tut__dot ${cls}"></span>`;
    }).join('');

    _tooltip.innerHTML = `
      <div class="tut__header">
        <div class="tut__header-icon" aria-hidden="true">${step.icon}</div>
        <div class="tut__header-title">${step.title}</div>
      </div>
      <div class="tut__body">${step.body}</div>
      <div class="tut__footer">
        <div class="tut__progress"
             role="progressbar"
             aria-valuenow="${idx + 1}" aria-valuemin="1" aria-valuemax="${STEPS.length}"
             aria-label="Paso ${idx + 1} de ${STEPS.length}">${dots}</div>
        <div class="tut__actions">
          ${!isFirst ? `<button class="btn btn-ghost btn-sm" id="tut-prev" aria-label="Paso anterior">Anterior</button>` : ''}
          ${!isLast
            ? `<button class="btn btn-primary btn-sm" id="tut-next" aria-label="Siguiente paso">Siguiente</button>`
            : `<button class="btn btn-primary btn-sm" id="tut-finish">¡Empezar!</button>`}
        </div>
        ${!isLast ? `<button class="tut__skip" id="tut-skip" aria-label="Saltar tutorial">Saltar</button>` : ''}
      </div>`;

    document.getElementById('tut-prev')?.addEventListener('click',   _prev);
    document.getElementById('tut-next')?.addEventListener('click',   _next);
    document.getElementById('tut-finish')?.addEventListener('click', stop);
    document.getElementById('tut-skip')?.addEventListener('click',   stop);

    /* ── Position tooltip ── */
    if (!isCenter) {
      requestAnimationFrame(() => _placeTooltip(targetEl, step.position));
    }
  };

  /* ── Tooltip placement with auto-flip ── */
  const _placeTooltip = (targetEl, position) => {
    if (!targetEl || !_tooltip) return;
    const r  = targetEl.getBoundingClientRect();
    const tw = _tooltip.offsetWidth;
    const th = _tooltip.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fits = {
      bottom: r.bottom + GAP + th + 8 <= vh,
      top:    r.top    - GAP - th - 8 >= 0,
      right:  r.right  + GAP + tw + 8 <= vw,
      left:   r.left   - GAP - tw - 8 >= 0,
    };

    let pos = position;
    if (!fits[pos]) {
      const flip = { bottom: 'top', top: 'bottom', right: 'left', left: 'right' };
      if (fits[flip[pos]])  pos = flip[pos];
      else if (fits.bottom) pos = 'bottom';
      else if (fits.top)    pos = 'top';
      else if (fits.right)  pos = 'right';
      else                  pos = 'left';
    }

    let top, left;
    switch (pos) {
      case 'bottom': top = r.bottom + GAP;            left = r.left + (r.width  - tw) / 2; break;
      case 'top':    top = r.top - th - GAP;          left = r.left + (r.width  - tw) / 2; break;
      case 'right':  top = r.top + (r.height - th) / 2; left = r.right + GAP;              break;
      case 'left':   top = r.top + (r.height - th) / 2; left = r.left - tw - GAP;          break;
    }

    const EDGE = 8;
    left = Math.max(EDGE, Math.min(left, vw - tw - EDGE));
    top  = Math.max(EDGE, Math.min(top,  vh - th - EDGE));

    _tooltip.style.left = `${left}px`;
    _tooltip.style.top  = `${top}px`;
  };

  const _isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.bottom > 0;
  };

  const _next = () => { if (_step < STEPS.length - 1) _showStep(++_step); };
  const _prev = () => { if (_step > 0)                _showStep(--_step); };

  return { start, stop, autoStart };
})();
