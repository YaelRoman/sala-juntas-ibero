/* ============================================================
   RESERVATION-MODAL.JS — Modal de reservación rápida (multi-intervalo)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const ReservationModal = (() => {

  let _overlay         = null;
  let _intervals       = [];
  let _users           = [];
  let _onSaved         = null;
  let _aiEnabled       = false;
  let _prefill         = null;  // { responsible_id, area, observations }
  let _editReservation = null;  // full reservation object when editing

  /**
   * @param {object}   opts
   * @param {Array}    [opts.intervals]        — [{date, startTime, endTime}, ...] (create mode)
   * @param {object}   [opts.editReservation]  — existing reservation object (edit mode)
   * @param {Function} [opts.onSaved]          — (savedArray) => void
   */
  const open = async ({ intervals = [], editReservation = null, onSaved = null, prefill = null } = {}) => {
    if (_overlay) close();

    _editReservation = editReservation ?? null;
    _onSaved         = onSaved;
    _prefill         = prefill;

    if (_editReservation) {
      const r    = _editReservation;
      _intervals = [{ date: r.date, startTime: r.startTime, endTime: r.endTime }];
    } else {
      if (!intervals.length) {
        Toast?.show('Selecciona al menos una hora antes de reservar.', 'warning');
        return;
      }
      _intervals = intervals.map(iv => ({ ...iv }));
      _intervals = _adjustForPartialOccupancy(_intervals);
    }

    try {
      const [users, ai] = await Promise.all([
        API.getUsers().catch(() => []),
        API.aiStatus().catch(() => ({ enabled: false })),
      ]);
      _users     = Array.isArray(users) ? users : [];
      _aiEnabled = Boolean(ai?.enabled);
    } catch {
      _users     = [];
      _aiEnabled = false;
    }

    _render();
  };

  const close = () => {
    if (!_overlay) return;
    _overlay._cleanup?.();
    _overlay.remove();
    _overlay          = null;
    _editReservation  = null;
  };

  /* ── HELPERS ── */

  const _toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const _fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  /**
   * For each interval, if existing reservations partially overlap (but don't
   * fully block) the slot, advance startTime / retreat endTime to the first
   * free 30-min window so the modal pre-fills a non-conflicting range.
   */
  const _adjustForPartialOccupancy = (intervals) => {
    const active = (Store.getState().reservations || []).filter(r => r.status !== 'cancelled');
    return intervals.map(iv => {
      const dayRes = active.filter(r => r.date === iv.date);
      if (!dayRes.length) return iv;

      const slotStart = _toMin(iv.startTime);
      const slotEnd   = _toMin(iv.endTime);

      // Reservations that partially overlap this slot (don't fully cover it)
      const partials = dayRes.filter(r => {
        const rs = _toMin(r.startTime), re = _toMin(r.endTime);
        return rs < slotEnd && re > slotStart && !(rs <= slotStart && re >= slotEnd);
      });
      if (!partials.length) return iv;

      // Walk through 30-min windows inside the slot and find the first free one
      for (let t = slotStart; t < slotEnd; t += 30) {
        const wEnd = t + 30;
        const blocked = partials.some(r => {
          const rs = _toMin(r.startTime), re = _toMin(r.endTime);
          return rs < wEnd && re > t;
        });
        if (!blocked) {
          // Extend the window to cover the rest of the slot unless blocked
          let freeEnd = wEnd;
          while (freeEnd < slotEnd) {
            const nextEnd = freeEnd + 30;
            const nextBlocked = partials.some(r => {
              const rs = _toMin(r.startTime), re = _toMin(r.endTime);
              return rs < nextEnd && re > freeEnd;
            });
            if (nextBlocked) break;
            freeEnd = nextEnd;
          }
          return { ...iv, startTime: _fromMin(t), endTime: _fromMin(freeEnd) };
        }
      }

      // No free window — return as-is, backend will catch the conflict
      return iv;
    });
  };

  const _timeOptions = (selected) => {
    const opts = [];
    for (let h = 7; h <= 21; h++) {
      const hh = String(h).padStart(2, '0');
      opts.push(`<option value="${hh}:00"${selected === `${hh}:00` ? ' selected' : ''}>${hh}:00</option>`);
      if (h < 21) opts.push(`<option value="${hh}:30"${selected === `${hh}:30` ? ' selected' : ''}>${hh}:30</option>`);
    }
    return opts.join('');
  };

  const _populateResponsibleSelect = (sel) => {
    const current = sel.value;
    sel.innerHTML = '<option value="">— Selecciona un responsable —</option>';
    _users.forEach(u => {
      const opt = document.createElement('option');
      opt.value       = u.id;
      opt.textContent = `${u.name} (${u.role})`;
      sel.appendChild(opt);
    });
    const newOpt = document.createElement('option');
    newOpt.value       = '__new__';
    newOpt.textContent = '+ Crear nuevo usuario…';
    sel.appendChild(newOpt);
    if (current && current !== '__new__') sel.value = current;
  };

  /* ── RENDER ── */
  const _render = () => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'rmodal-title');

    const n        = _intervals.length;
    const isSingle = n === 1;
    const isEdit   = Boolean(_editReservation);

    overlay.innerHTML = `
      <div class="modal-dialog modal-dialog--lg rmodal">
        <div class="rmodal__accent-bar"></div>

        <div class="modal-header rmodal__header">
          <div class="rmodal__header-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8"  y1="2" x2="8"  y2="6"/>
              <line x1="3"  y1="10" x2="21" y2="10"/>
            </svg>
          </div>
          <div class="rmodal__header-text">
            <h3 id="rmodal-title">${isEdit ? 'Editar reservación' : 'Nueva reservación'}</h3>
            <p class="rmodal__header-sub">${isEdit ? Utils.escapeHTML(Utils.formatDateShort(_editReservation.date)) : `${n} horario${n !== 1 ? 's' : ''} seleccionado${n !== 1 ? 's' : ''}`}</p>
          </div>
          <button type="button" class="rmodal__close" aria-label="Cerrar" data-rmodal-close>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="modal-body rmodal__body">

          <!-- 1. Horarios con ajuste fino -->
          <div class="rmodal__section">
            <div class="rmodal__label">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
              </svg>
              Horarios
            </div>
            <div class="rmodal__iv-list">
              ${_intervals.map((iv, i) => `
                <div class="rmodal__iv-row" data-idx="${i}">
                  <span class="rmodal__iv-date">${Utils.escapeHTML(Utils.formatDateShort(iv.date))}</span>
                  <select class="form-select rmodal__iv-select" data-iv-start="${i}" aria-label="Hora inicio">
                    ${_timeOptions(iv.startTime)}
                  </select>
                  <span class="rmodal__iv-arrow" aria-hidden="true">→</span>
                  <select class="form-select rmodal__iv-select" data-iv-end="${i}" aria-label="Hora fin">
                    ${_timeOptions(iv.endTime)}
                  </select>
                </div>
                <div class="rmodal__iv-overlap hidden" data-iv-overlap="${i}" role="status" aria-live="polite"></div>
              `).join('')}
            </div>
          </div>

          <!-- 2. Asistente IA (condicional) -->
          ${_aiEnabled ? `
          <div class="rmodal__section rmodal__ai-section">
            <label class="rmodal__toggle">
              <input type="checkbox" id="rmodal-ai-toggle" />
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1H1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/>
              </svg>
              <span>Asistente IA — auto-rellenar formulario</span>
            </label>
            <div id="rmodal-ai-panel" class="rmodal__ai-panel hidden">
              <textarea id="rmodal-ai-text" class="form-textarea" rows="2"
                        placeholder="Ej: Reunión con Dr. López sobre presupuesto Q2, área de Posgrado."></textarea>
              <div class="rmodal__ai-footer">
                <button type="button" class="btn btn-secondary btn-sm" id="rmodal-ai-run">Analizar</button>
                <span id="rmodal-ai-status" class="rmodal__ai-status"></span>
              </div>
            </div>
          </div>` : ''}

          <!-- 3. Datos de la reservación -->
          <div class="rmodal__section">
            <div class="rmodal__label">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
              Datos de la reservación
            </div>

            <div class="rmodal__field">
              <label for="rmodal-responsible">
                Responsable <span class="rmodal__required">*</span>
              </label>
              <select id="rmodal-responsible" class="form-select"></select>
            </div>

            <div id="rmodal-new-user-panel" class="rmodal__new-user hidden">
              <div class="rmodal__new-user-title">Crear nuevo usuario</div>
              <div class="rmodal__new-user-grid">
                <div class="rmodal__field">
                  <label for="rmodal-nu-name">Nombre <span class="rmodal__required">*</span></label>
                  <input type="text" id="rmodal-nu-name" class="form-input" placeholder="Nombre completo" />
                </div>
                <div class="rmodal__field">
                  <label for="rmodal-nu-email">Correo <span class="rmodal__required">*</span></label>
                  <input type="email" id="rmodal-nu-email" class="form-input" placeholder="usuario@ibero.mx" />
                </div>
                <div class="rmodal__field">
                  <label for="rmodal-nu-pwd">
                    Contraseña <span class="rmodal__required">*</span>
                    <span class="rmodal__hint">(mín. 8 car.)</span>
                  </label>
                  <input type="password" id="rmodal-nu-pwd" class="form-input" />
                </div>
                <div class="rmodal__field">
                  <label for="rmodal-nu-role">Rol</label>
                  <select id="rmodal-nu-role" class="form-select">
                    <option value="academico" selected>Académico</option>
                    <option value="secretaria">Secretaria</option>
                  </select>
                </div>
              </div>
              <div class="rmodal__new-user-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="rmodal-nu-cancel">Cancelar</button>
                <button type="button" class="btn btn-primary btn-sm" id="rmodal-nu-save">Crear usuario</button>
              </div>
            </div>

            <div class="rmodal__field">
              <label for="rmodal-area">
                Área <span class="rmodal__required">*</span>
              </label>
              <input type="text" id="rmodal-area" class="form-input"
                     placeholder="Ej: Coordinación de Posgrado" maxlength="200" />
            </div>

            <div class="rmodal__field">
              <label for="rmodal-obs">Observaciones</label>
              <textarea id="rmodal-obs" class="form-textarea" rows="2" maxlength="500"
                        placeholder="Notas adicionales…"></textarea>
            </div>
          </div>

          <!-- 4. Recurrencia (solo para un solo intervalo nuevo) -->
          ${isSingle && !isEdit ? `
          <div class="rmodal__section rmodal__recur-section">
            <label class="rmodal__toggle">
              <input type="checkbox" id="rmodal-recur-chk" />
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                   stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="17 1 21 5 17 9"/>
                <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                <polyline points="7 23 3 19 7 15"/>
                <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
              </svg>
              <span>Reservación recurrente</span>
            </label>
            <div id="rmodal-recur-panel" class="rmodal__recur-panel hidden">
              <div class="rmodal__recur-grid">
                <div class="rmodal__field">
                  <label for="rmodal-recur-freq">Frecuencia</label>
                  <select id="rmodal-recur-freq" class="form-select">
                    <option value="daily">Diaria</option>
                    <option value="weekly">Semanal</option>
                    <option value="biweekly">Quincenal</option>
                    <option value="monthly">Mensual</option>
                  </select>
                </div>
                <div class="rmodal__field">
                  <label for="rmodal-recur-count">Ocurrencias</label>
                  <input type="number" id="rmodal-recur-count" class="form-input"
                         min="2" max="52" value="4" />
                </div>
              </div>
              <div class="rmodal__field">
                <label for="rmodal-recur-end">Hasta (opcional)</label>
                <input type="date" id="rmodal-recur-end" class="form-input"
                       min="${_intervals[0].date}" />
              </div>
            </div>
          </div>` : ''}

          <div id="rmodal-error" class="rmodal__error hidden"></div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" data-rmodal-close>Cancelar</button>
          <button type="button" class="btn btn-primary" id="rmodal-save">
            ${isEdit ? 'Guardar cambios' : `Guardar ${n > 1 ? `(${n} reservaciones)` : 'reservación'}`}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    _overlay = overlay;

    const respSel = overlay.querySelector('#rmodal-responsible');
    if (respSel) _populateResponsibleSelect(respSel);

    if (_editReservation) {
      const r      = _editReservation;
      const areaEl = overlay.querySelector('#rmodal-area');
      const obsEl  = overlay.querySelector('#rmodal-obs');
      if (respSel) respSel.value = String(r.responsible_id);
      if (areaEl)  areaEl.value  = r.area ?? '';
      if (obsEl)   obsEl.value   = r.observations ?? '';
    } else if (_prefill) {
      if (_prefill.responsible_id) respSel.value = String(_prefill.responsible_id);
      const areaEl = overlay.querySelector('#rmodal-area');
      const obsEl  = overlay.querySelector('#rmodal-obs');
      if (areaEl && _prefill.area)         areaEl.value = _prefill.area;
      if (obsEl  && _prefill.observations) obsEl.value  = _prefill.observations;
    }

    _wireEvents();
    _intervals.forEach((_, i) => _checkIvOverlap(i));
    respSel?.focus();
  };

  /* ── OVERLAP CHECK ── */
  const _checkIvOverlap = (idx) => {
    const iv = _intervals[idx];
    const el = _overlay?.querySelector(`[data-iv-overlap="${idx}"]`);
    if (!el) return;
    if (!iv.startTime || !iv.endTime || iv.startTime >= iv.endTime) {
      el.className = 'rmodal__iv-overlap hidden';
      return;
    }
    const conflict = Reservations.checkOverlap(iv.date, iv.startTime, iv.endTime, _editReservation?.id ?? null);
    el.classList.remove('hidden', 'is-conflict', 'is-available');
    if (conflict) {
      el.classList.add('is-conflict');
      el.innerHTML = `Traslape con <strong>${Utils.escapeHTML(conflict.responsible)}</strong> (${conflict.startTime}–${conflict.endTime})`;
    } else {
      el.classList.add('is-available');
      el.textContent = 'Horario disponible';
    }
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

    // Interval time selects — update _intervals and auto-advance end if needed
    _overlay.querySelectorAll('[data-iv-start]').forEach(sel => {
      const idx = parseInt(sel.dataset.ivStart, 10);
      sel.addEventListener('change', () => {
        _intervals[idx].startTime = sel.value;
        const endSel = _overlay.querySelector(`[data-iv-end="${idx}"]`);
        if (endSel && endSel.value <= sel.value) {
          const [h, m] = sel.value.split(':').map(Number);
          const total  = h * 60 + m + 60;
          const nh     = Math.min(Math.floor(total / 60), 21);
          const nm     = total % 60;
          const newEnd = `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
          endSel.value              = newEnd;
          _intervals[idx].endTime   = newEnd;
        }
        _checkIvOverlap(idx);
      });
    });
    _overlay.querySelectorAll('[data-iv-end]').forEach(sel => {
      const idx = parseInt(sel.dataset.ivEnd, 10);
      sel.addEventListener('change', () => {
        _intervals[idx].endTime = sel.value;
        _checkIvOverlap(idx);
      });
    });

    // AI toggle
    const aiToggle = _overlay.querySelector('#rmodal-ai-toggle');
    const aiPanel  = _overlay.querySelector('#rmodal-ai-panel');
    aiToggle?.addEventListener('change', () => {
      aiPanel.classList.toggle('hidden', !aiToggle.checked);
      if (aiToggle.checked) _overlay.querySelector('#rmodal-ai-text')?.focus();
    });
    _overlay.querySelector('#rmodal-ai-run')?.addEventListener('click', _runAI);

    // Responsible select + new user panel
    const respSel      = _overlay.querySelector('#rmodal-responsible');
    const newUserPanel = _overlay.querySelector('#rmodal-new-user-panel');
    respSel?.addEventListener('change', () => {
      const isNew = respSel.value === '__new__';
      newUserPanel?.classList.toggle('hidden', !isNew);
      if (isNew) _overlay.querySelector('#rmodal-nu-name')?.focus();
    });

    _overlay.querySelector('#rmodal-nu-cancel')?.addEventListener('click', () => {
      respSel.value = '';
      newUserPanel?.classList.add('hidden');
    });
    _overlay.querySelector('#rmodal-nu-save')?.addEventListener('click', _createNewUser);

    // Recurring toggle
    const recurChk   = _overlay.querySelector('#rmodal-recur-chk');
    const recurPanel = _overlay.querySelector('#rmodal-recur-panel');
    recurChk?.addEventListener('change', () => {
      recurPanel?.classList.toggle('hidden', !recurChk.checked);
    });

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
        const sel   = _overlay.querySelector('#rmodal-responsible');
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
        ? `${filled} campo${filled !== 1 ? 's' : ''} rellenado${filled !== 1 ? 's' : ''}. Revisa antes de guardar.`
        : 'No se pudo extraer información. Rellena manualmente.';
    } catch (err) {
      console.error('AI parse error:', err);
      statusEl.textContent = 'Error al consultar la IA.';
    }
  };

  /* ── CREAR NUEVO USUARIO ── */
  const _createNewUser = async () => {
    const name     = (_overlay.querySelector('#rmodal-nu-name')?.value ?? '').trim();
    const email    = (_overlay.querySelector('#rmodal-nu-email')?.value ?? '').trim();
    const password = _overlay.querySelector('#rmodal-nu-pwd')?.value ?? '';
    const role     = _overlay.querySelector('#rmodal-nu-role')?.value ?? 'academico';

    if (!name || !email || password.length < 8) {
      Toast?.show('Completa todos los campos. La contraseña debe tener al menos 8 caracteres.', 'warning');
      return;
    }

    const saveBtn       = _overlay.querySelector('#rmodal-nu-save');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Creando…';

    try {
      const created = await API.createUser({ name, email, password, role });
      _users.push(created);
      const respSel = _overlay.querySelector('#rmodal-responsible');
      _populateResponsibleSelect(respSel);
      respSel.value = created.id;
      _overlay.querySelector('#rmodal-new-user-panel')?.classList.add('hidden');
      Toast?.show(`Usuario "${Utils.escapeHTML(name)}" creado.`, 'success');
    } catch (err) {
      const msg = err.status === 409 ? 'El correo ya está registrado.' : 'Error al crear el usuario.';
      Toast?.show(msg, 'error');
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Crear usuario';
    }
  };

  /* ── GUARDAR ── */
  const _save = async () => {
    const respEl  = _overlay.querySelector('#rmodal-responsible');
    const areaEl  = _overlay.querySelector('#rmodal-area');
    const obsEl   = _overlay.querySelector('#rmodal-obs');
    const errEl   = _overlay.querySelector('#rmodal-error');
    const saveBtn = _overlay.querySelector('#rmodal-save');

    if (respEl.value === '__new__') {
      errEl.textContent = 'Completa o cancela la creación del nuevo responsable.';
      errEl.classList.remove('hidden');
      return;
    }

    const responsible_id = respEl.value;
    const area           = areaEl.value.trim();
    const observations   = obsEl.value.trim();

    if (!responsible_id || !area) {
      errEl.textContent = 'Completa los campos obligatorios (responsable y área).';
      errEl.classList.remove('hidden');
      return;
    }

    for (const iv of _intervals) {
      if (iv.startTime >= iv.endTime) {
        errEl.textContent = `Horario inválido: la hora de fin debe ser posterior al inicio (${iv.date}).`;
        errEl.classList.remove('hidden');
        return;
      }
    }

    errEl.classList.add('hidden');
    saveBtn.disabled    = true;
    saveBtn.textContent = 'Guardando…';

    // Edit path
    if (_editReservation) {
      const iv = _intervals[0];
      const result = await Reservations.update(_editReservation.id, {
        start_time:     `${iv.date}T${iv.startTime}:00`,
        end_time:       `${iv.date}T${iv.endTime}:00`,
        responsible_id,
        area,
        observations,
      });
      if (result.success) {
        Toast?.show('Reservación actualizada correctamente.', 'success');
        _onSaved?.(null);
        close();
      } else {
        errEl.textContent = result.error === 'overlap'
          ? 'Traslape con otra reservación.'
          : result.error || 'Error al actualizar.';
        errEl.classList.remove('hidden');
        saveBtn.disabled    = false;
        saveBtn.textContent = 'Guardar cambios';
      }
      return;
    }

    // Recurring path (single interval only)
    const recurChk = _overlay.querySelector('#rmodal-recur-chk');
    if (recurChk?.checked && _intervals.length === 1) {
      await _saveRecurring({ responsible_id, area, observations });
      saveBtn.disabled    = false;
      saveBtn.textContent = 'Guardar reservación';
      return;
    }

    // Normal multi-interval path
    const intervals = _intervals.map(iv => ({
      start_time: `${iv.date}T${iv.startTime}:00`,
      end_time:   `${iv.date}T${iv.endTime}:00`,
    }));

    try {
      const { reservations: created } = await API.createMultiReservation({
        intervals,
        responsible_id,
        area,
        observations,
      });

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
        const c   = err.data?.conflictWith;
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
      saveBtn.disabled    = false;
      saveBtn.textContent = _intervals.length > 1
        ? `Guardar (${_intervals.length} reservaciones)`
        : 'Guardar reservación';
    }
  };

  const _saveRecurring = async ({ responsible_id, area, observations }) => {
    const iv      = _intervals[0];
    const freq    = _overlay.querySelector('#rmodal-recur-freq')?.value ?? 'weekly';
    const rawCnt  = parseInt(_overlay.querySelector('#rmodal-recur-count')?.value ?? '4', 10);
    const count   = Math.min(Math.max(isNaN(rawCnt) ? 4 : rawCnt, 2), 52);
    const endDate = _overlay.querySelector('#rmodal-recur-end')?.value || null;
    const errEl   = _overlay.querySelector('#rmodal-error');

    const { group, instances, skipped } = Recurring.generate({
      date: iv.date, startTime: iv.startTime, endTime: iv.endTime,
      responsible_id, area, observations,
      frequency: freq, count, endDate,
    });

    if (!instances.length) {
      errEl.textContent = 'No se generaron instancias. Todos los días están ocupados, son festivos o fin de semana.';
      errEl.classList.remove('hidden');
      return;
    }

    try {
      const savedCount = await Recurring.save({ group, instances });
      if (!savedCount) {
        errEl.textContent = 'No se guardaron instancias. Inténtalo de nuevo.';
        errEl.classList.remove('hidden');
        return;
      }
      const skipMsg = skipped.length
        ? ` ${skipped.length} fecha${skipped.length !== 1 ? 's' : ''} omitida${skipped.length !== 1 ? 's' : ''}.`
        : '';
      Toast?.show(`Serie creada: ${savedCount} reservación${savedCount !== 1 ? 'es' : ''}.${skipMsg}`, 'success');
      _onSaved?.([]);
      close();
    } catch (err) {
      console.error('Error saving recurring series:', err);
      errEl.textContent = 'Error al crear la serie. Inténtalo de nuevo.';
      errEl.classList.remove('hidden');
    }
  };

  return { open, close };
})();
