/* ============================================================
   HOLIDAYS.JS — Gestión de días festivos y cierres institucionales
   HU-05: Configurar días festivos y cierres
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const Holidays = (() => {

  /* ── LECTURA ── */
  const getAll = () => Store.getState().holidays;

  /** Devuelve sólo los días festivos */
  const getHolidays = () => getAll().filter(h => h.type === 'holiday');

  /** Devuelve sólo los cierres institucionales */
  const getClosures = () => getAll().filter(h => h.type === 'closure');

  /** Devuelve sólo los eventos (no bloquean reservaciones) */
  const getEvents = () => getAll().filter(h => h.type === 'evento');

  /* ── ESCRITURA ── */

  /**
   * Agrega una fecha especial.
   * @param {{ date: string, name: string, type: 'holiday'|'closure' }} entry
   */
  const add = async ({ date, name, type }) => {
    try {
      const result = await API.createHoliday({ date, name, type });
      Store.setState({ holidays: [...getAll(), result] });
      return { success: true };
    } catch (err) {
      console.error('Add holiday error:', err);
      return { success: false, error: err.message };
    }
  };

  /**
   * Elimina una fecha especial por ID.
   * @param {string} id
   */
  const remove = async (id) => {
    try {
      await API.deleteHoliday(id);
      Store.setState({ holidays: getAll().filter(h => h.id !== id) });
      return true;
    } catch (err) {
      console.error('Delete holiday error:', err);
      return false;
    }
  };

  /* ── VALIDACIÓN ── */

  /**
   * ¿Hay reservaciones activas en esa fecha?
   * @param {string} dateStr  — formato "YYYY-MM-DD"
   * @returns {number}  — cantidad de reservaciones en conflicto
   */
  const conflictCount = (dateStr) =>
    Store.getReservations({ status: 'active' }).filter(r => r.date === dateStr).length;

  /* ── RENDERIZADO DE LISTA ── */

  /**
   * Renderiza la lista de fechas marcadas en el contenedor dado.
   * Incluye botones de eliminación con confirmación.
   * @param {string} containerId
   * @param {Function} [onChanged]  — callback tras eliminar
   */
  const renderList = (containerId, onChanged) => {
    const el = document.getElementById(containerId);
    if (!el) return;

    const all = getAll().slice().sort((a, b) => a.date.localeCompare(b.date));

    if (!all.length) {
      el.innerHTML = `
        <div class="holiday-list__empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.5"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8"  y1="2" x2="8"  y2="6"/>
            <line x1="3"  y1="10" x2="21" y2="10"/>
          </svg>
          <p>No hay fechas marcadas.</p>
        </div>`;
      return;
    }

    el.innerHTML = all.map(h => {
      const typeLabel = h.type === 'holiday' ? 'Día Festivo'
                      : h.type === 'closure' ? 'Cierre Inst.'
                      : 'Evento';
      const typeCls   = h.type === 'holiday' ? 'badge-warning'
                      : h.type === 'evento'  ? 'badge-info'
                      : 'badge-neutral';
      const dotColor  = h.type === 'holiday' ? 'var(--cal-holiday)'
                      : h.type === 'evento'  ? 'var(--cal-evento)'
                      : 'var(--cal-closed)';
      const conflicts = conflictCount(h.date);
      return `
        <div class="holiday-item" role="listitem">
          <span class="holiday-item__dot" style="background:${dotColor};" aria-hidden="true"></span>
          <div class="holiday-item__info">
            <span class="holiday-item__date">${Utils.formatDateShort(h.date)}</span>
            <span class="holiday-item__name">${Utils.escapeHTML(h.name)}</span>
            ${conflicts ? `<span class="holiday-item__conflict" title="${conflicts} reservación(es) activa(s) en esta fecha">⚠ ${conflicts}</span>` : ''}
          </div>
          <span class="badge ${typeCls} holiday-item__badge">${typeLabel}</span>
          <button class="btn btn-ghost btn-sm holiday-item__del icon-btn"
                  data-date="${h.date}" data-type="${h.type}"
                  aria-label="Eliminar ${Utils.escapeHTML(h.name)}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
              <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
            </svg>
          </button>
        </div>`;
    }).join('');

    // Botones de eliminar
    el.querySelectorAll('.holiday-item__del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const name = btn.closest('.holiday-item')
                        .querySelector('.holiday-item__name').textContent;
        if (!confirm(`¿Eliminar "${name}"?`)) return;
        const success = await remove(btn.dataset.id || btn.dataset.date);
        if (success) {
          renderList(containerId, onChanged);
          onChanged?.();
        }
      });
    });
  };

  return {
    getAll,
    getHolidays,
    getClosures,
    getEvents,
    add,
    remove,
    conflictCount,
    renderList,
  };
})();
