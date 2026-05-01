/* ============================================================
   RESERVATION-MODAL.JS — Modal de reservación rápida (multi-intervalo)
   Permite crear una o varias reservaciones desde el mismo dashboard,
   sin cambiar de página. Soporta auto-relleno con asistente IA.
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const ReservationModal = (() => {

  let _overlay  = null;
  let _intervals = [];
  let _users    = [];
  let _onSaved  = null;
  let _aiEnabled = false;

  /**
   * Abre el modal con la selección actual.
   * @param {object}   opts
   * @param {Array}    opts.intervals  — [{date, startTime, endTime}, ...]
   * @param {Function} [opts.onSaved]  — (createdArray) => void
   */
  const open = async ({ intervals = [], onSaved = null } = {}) => {
    if (!intervals.length) {
      Toast?.show('Selecciona al menos una hora antes de reservar.', 'warning');
      return;
    }
    if (_overlay) close();

    _intervals = intervals.slice();
    _onSaved   = onSaved;

    // Pre-cargar usuarios + estado IA
    try {
      const [users, ai] = await Promise.all([
        API.getUsers().catch(() => []),
        API.aiStatus().catch(() => ({ enabled: false })),
      ]);
      _users = Array.isArray(users) ? users : [];
      _aiEnabled = Boolean(ai?.enabled);
    } catch {
      _users = [];
      _aiEnabled = false;
    }

    _render();
  };

  const close = () => {
    if (!_overlay) return;
    _overlay._cleanup?.();
    _overlay.remove();
    _overlay = null;
  };

  /* ── RENDER ── */
  const _render = () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'rmodal-title');

    overlay.innerHTML = `
      <div class="modal-dialog modal-dialog--lg rmodal">
        <div class="modal-header">
          <svg width="18" height="18" class="modal-header__icon" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8"  y1="2" x2="8"  y2="6"/>
            <line x1="3"  y1="10" x2="21" y2="10"/>
          </svg>
          <h3 id="rmodal-title">Nueva reservación</h3>
          <button type="button" class="rmodal__close" aria-label="Cerrar" data-rmodal-close>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="modal-body">
          <div class="rmodal__section">
            <div class="rmodal__label">Horarios seleccionados</div>
            <ul class="rmodal__intervals">
              ${_intervals.map(iv => `
                <li>
                  <strong>${Utils.escapeHTML(Utils.formatDateLong(iv.date))}</strong>
                  · ${iv.startTime}–${iv.endTime}
                </li>
              `).join('')}
            </ul>
          </div>

          ${_aiEnabled ? `
          <div class="rmodal__section rmodal__ai">
            <label class="rmodal__toggle">
              <input type="checkbox" id="rmodal-ai-toggle" />
              <span>Usar IA para auto-rellenar el formulario</span>
            </label>
            <div id="rmodal-ai-panel" class="rmodal__ai-panel hidden">
              <textarea id="rmodal-ai-text" class="form-control" rows="2"
                        placeholder="Ej: Reunión con Dr. López sobre presupuesto Q2, área de Posgrado."></textarea>
              <button type="button" class="btn btn-secondary btn-sm" id="rmodal-ai-run">
                Analizar y rellenar
              </button>
              <span id="rmodal-ai-status" class="rmodal__ai-status"></span>
            </div>
          </div>` : ''}

          <div class="rmodal__section">
            <div class="rmodal__field">
              <label for="rmodal-responsible">Responsable *</label>
              <select id="rmodal-responsible" class="form-control">
                <option value="">— Selecciona un responsable —</option>
                ${_users.map(u =>
                  `<option value="${u.id}">${Utils.escapeHTML(u.name)} (${u.role})</option>`
                ).join('')}
              </select>
            </div>

            <div class="rmodal__field">
              <label for="rmodal-area">Área *</label>
              <input type="text" id="rmodal-area" class="form-control"
                     placeholder="Ej: Coordinación de Posgrado" maxlength="200" />
            </div>

            <div class="rmodal__field">
              <label for="rmodal-obs">Observaciones</label>
              <textarea id="rmodal-obs" class="form-control" rows="3" maxlength="500"
                        placeholder="Notas adicionales sobre la reservación…"></textarea>
            </div>
          </div>

          <div id="rmodal-error" class="rmodal__error hidden"></div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-rmodal-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="rmodal-save">
            Guardar ${_intervals.length > 1 ? `(${_intervals.length} reservaciones)` : 'reservación'}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    _overlay = overlay;
    _wireEvents();
    overlay.querySelector('#rmodal-responsible')?.focus();
  };

  /* ── EVENTOS ── */
  const _wireEvents = () => {
    if (!_overlay) return;

    _overlay.querySelectorAll('[data-rmodal-close]').forEach(b =>
      b.addEventListener('click', close)
    );
    _overlay.addEventListener('click', (e) => {
      if (e.target === _overlay) close();
    });

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    _overlay._cleanup = () => document.removeEventListener('keydown', onKey);

    // Toggle AI
    const aiToggle = _overlay.querySelector('#rmodal-ai-toggle');
    const aiPanel  = _overlay.querySelector('#rmodal-ai-panel');
    aiToggle?.addEventListener('change', () => {
      aiPanel.classList.toggle('hidden', !aiToggle.checked);
      if (aiToggle.checked) _overlay.querySelector('#rmodal-ai-text')?.focus();
    });

    _overlay.querySelector('#rmodal-ai-run')?.addEventListener('click', _runAI);
    _overlay.querySelector('#rmodal-save')?.addEventListener('click', _save);
  };

  /* ── ASISTENTE IA ── */
  const _runAI = async () => {
    const textEl   = _overlay.querySelector('#rmodal-ai-text');
    const statusEl = _overlay.querySelector('#rmodal-ai-status');
    const text     = (textEl?.value ?? '').trim();
    if (!text) {
      statusEl.textContent = 'Escribe una descripción primero.';
      return;
    }

    statusEl.textContent = 'Analizando…';
    try {
      const parsed = await AI.parse(text);
      let filled = 0;

      if (parsed.responsible) {
        const sel = _overlay.querySelector('#rmodal-responsible');
        const match = _users.find(u =>
          u.name.toLowerCase().includes(parsed.responsible.toLowerCase())
        );
        if (match && sel) { sel.value = match.id; filled++; }
      }
      if (parsed.area) {
        const areaEl = _overlay.querySelector('#rmodal-area');
        if (areaEl) { areaEl.value = parsed.area; filled++; }
      }
      if (parsed.observations) {
        const obsEl = _overlay.querySelector('#rmodal-obs');
        if (obsEl) { obsEl.value = parsed.observations; filled++; }
      }

      statusEl.textContent = filled
        ? `Rellenados ${filled} campo${filled !== 1 ? 's' : ''}. Revisa y ajusta antes de guardar.`
        : 'No se pudo extraer información. Rellena manualmente.';
    } catch (err) {
      console.error('AI parse error:', err);
      statusEl.textContent = 'Error al consultar la IA. Rellena manualmente.';
    }
  };

  /* ── GUARDAR ── */
  const _save = async () => {
    const respEl = _overlay.querySelector('#rmodal-responsible');
    const areaEl = _overlay.querySelector('#rmodal-area');
    const obsEl  = _overlay.querySelector('#rmodal-obs');
    const errEl  = _overlay.querySelector('#rmodal-error');
    const saveBtn = _overlay.querySelector('#rmodal-save');

    const responsible_id = respEl.value;
    const area           = areaEl.value.trim();
    const observations   = obsEl.value.trim();

    if (!responsible_id || !area) {
      errEl.textContent = 'Completa los campos obligatorios (responsable y área).';
      errEl.classList.remove('hidden');
      return;
    }
    errEl.classList.add('hidden');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando…';

    // Construir payload con start_time / end_time UTC (formato consistente con el resto del app)
    const intervals = _intervals.map(iv => ({
      start_time: `${iv.date}T${iv.startTime}:00Z`,
      end_time:   `${iv.date}T${iv.endTime}:00Z`,
    }));

    try {
      const { reservations: created } = await API.createMultiReservation({
        intervals,
        responsible_id,
        area,
        observations,
      });

      // Sincronizar Store
      created.forEach(r => Store.addReservation(r));

      Toast?.show(
        created.length > 1
          ? `Se crearon ${created.length} reservaciones.`
          : 'Reservación creada correctamente.',
        'success'
      );

      _onSaved?.(created);
      close();
    } catch (err) {
      console.error('Error creating multi reservation:', err);
      if (err.status === 409) {
        const c = err.data?.conflictWith;
        const idx = err.data?.intervalIndex;
        const which = (typeof idx === 'number' && _intervals[idx])
          ? `${_intervals[idx].date} ${_intervals[idx].startTime}–${_intervals[idx].endTime}`
          : 'uno de los horarios';
        errEl.innerHTML = `Conflicto: ${Utils.escapeHTML(which)} ya está reservado${
          c?.responsible_name ? ` por <strong>${Utils.escapeHTML(c.responsible_name)}</strong>` : ''
        }.`;
        errEl.classList.remove('hidden');
      } else {
        errEl.textContent = err.data?.error || err.message || 'Error al guardar.';
        errEl.classList.remove('hidden');
      }
      saveBtn.disabled = false;
      saveBtn.textContent = _intervals.length > 1
        ? `Guardar (${_intervals.length} reservaciones)`
        : 'Guardar reservación';
    }
  };

  return { open, close };
})();
