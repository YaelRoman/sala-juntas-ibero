/* ============================================================
   AI-PAGE.JS — Lógica del panel de Asistente IA
   HU-31 (lenguaje natural), HU-32 (propuesta editable),
   HU-33 (sugerencias de horario)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  Store.init();
  const user = Auth.requireAuth();
  if (!user) return;

  // Only secretaria accesses this page
  if (user.role !== 'secretaria') {
    window.location.href = 'calendar.html';
    return;
  }

  // Load reservations and users from API
  let _users = [];
  await Promise.allSettled([
    API.getReservations()
      .then(r => Store.setState({ reservations: r }))
      .catch(e => console.warn('[AI Page] reservations:', e.message)),
    API.getUsers()
      .then(u => { _users = u || []; })
      .catch(e => console.warn('[AI Page] users:', e.message)),
  ]);

  Sidebar.init('ai-panel');
  Auth.startInactivityWatcher();

  /* ── DOM refs ──────────────────────────────────────────── */
  const inputEl        = document.getElementById('ai-input');
  const btnProcess     = document.getElementById('btn-process');
  const btnClearInput  = document.getElementById('btn-clear-input');
  const loadingEl      = document.getElementById('ai-loading');
  const loadingText    = document.getElementById('ai-loading-text');
  const proposalEl     = document.getElementById('ai-proposal');
  const sourceBadge    = document.getElementById('ai-source-badge');
  const confidenceText = document.getElementById('ai-confidence-text');

  // Proposal fields
  const propDate    = document.getElementById('prop-date');
  const propStart   = document.getElementById('prop-start');
  const propEnd     = document.getElementById('prop-end');
  const propRespon  = document.getElementById('prop-responsible');
  const propArea    = document.getElementById('prop-area');
  const propObs     = document.getElementById('prop-observations');
  const overlapEl   = document.getElementById('prop-overlap');
  const overlapIcon = document.getElementById('prop-overlap-icon');
  const overlapText = document.getElementById('prop-overlap-text');

  const btnDiscard  = document.getElementById('btn-proposal-discard');
  const btnSave     = document.getElementById('btn-proposal-save');

  // New user panel
  const newUserPanel  = document.getElementById('new-user-panel');
  const newUserName   = document.getElementById('new-user-name');
  const newUserEmail  = document.getElementById('new-user-email');
  const newUserPwd    = document.getElementById('new-user-password');
  const newUserRole   = document.getElementById('new-user-role');
  const btnNewUserSave   = document.getElementById('btn-new-user-save');
  const btnNewUserCancel = document.getElementById('btn-new-user-cancel');

  // Suggestions
  const suggestDate = document.getElementById('suggest-date');
  const suggestList = document.getElementById('suggestions-list');

  /* ── Populate time selects ─────────────────────────────── */
  _populateTimeSelects();

  /* ── Populate responsible select ───────────────────────── */
  _populateResponsibleSelect();

  API.aiStatus().then(s => {
    if (!s?.enabled) Toast.show('Asistente IA en modo local. Sin clave API configurada.', 'info');
  });

  /* ════════════════════════════════════════════════════════
     EXAMPLE CHIPS
  ════════════════════════════════════════════════════════ */

  document.querySelectorAll('.ai-example-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (inputEl) inputEl.value = chip.dataset.example ?? '';
      inputEl?.focus();
    });
  });

  /* ── Clear input ── */
  btnClearInput?.addEventListener('click', () => {
    if (inputEl) inputEl.value = '';
    _hideProposal();
    inputEl?.focus();
  });

  /* ════════════════════════════════════════════════════════
     PROCESS BUTTON — main entry point
  ════════════════════════════════════════════════════════ */

  btnProcess?.addEventListener('click', _onProcess);

  inputEl?.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + Enter triggers process
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) _onProcess();
  });

  async function _onProcess() {
    const text = inputEl?.value?.trim();
    if (!text) {
      Toast.show('Escribe una descripción primero.', 'warning');
      inputEl?.focus();
      return;
    }

    const aiOn = await API.aiStatus().catch(() => ({ enabled: false }));
    _setLoading(true, aiOn.enabled ? 'Consultando IA…' : 'Procesando localmente…');
    _hideProposal();

    try {
      // Pass the currently-selected suggestion date as a hint so the backend
      // can load that day's reservations for conflict detection.
      const dateHint = suggestDate?.value || null;
      const result = await AI.parse(text, dateHint);
      _showProposal(result);

      // Auto-populate suggestions date from result
      if (result.date && suggestDate) {
        suggestDate.value = result.date;
        _renderSuggestions(result.date);
      }
    } catch (err) {
      console.error('[AI Page] parse error:', err);
      Toast.show('Error al procesar el texto. Intenta de nuevo.', 'error');
    } finally {
      _setLoading(false);
    }
  }

  /* ════════════════════════════════════════════════════════
     PROPOSAL DISPLAY & EDITING
  ════════════════════════════════════════════════════════ */

  function _showProposal(result) {
    // Populate fields
    if (propDate) propDate.value = result.date        ?? '';
    if (propArea) propArea.value = result.area        ?? '';
    if (propObs)  propObs.value  = result.observations ?? '';

    // Use the AI-matched user ID directly when available; otherwise fall back to name matching
    if (result.responsible_id) {
      if (propRespon) propRespon.value = result.responsible_id;
      newUserPanel?.classList.add('hidden');
      _validateProposal();
    } else if (result.responsible) {
      _tryMatchResponsible(result.responsible);
    }

    // If the AI detected a conflict, apply the suggested alternative times instead
    const useStart = (result.conflict && result.suggestedStartTime) ? result.suggestedStartTime : result.startTime;
    const useEnd   = (result.conflict && result.suggestedEndTime)   ? result.suggestedEndTime   : result.endTime;
    _setSelectValue(propStart, useStart ?? '');
    _setSelectValue(propEnd,   useEnd   ?? '');

    if (result.conflict && result.suggestedStartTime) {
      Toast.show(
        `El horario solicitado ya está ocupado. Se sugiere ${result.suggestedStartTime}–${result.suggestedEndTime}.`,
        'warning'
      );
    }

    // Source badge
    if (sourceBadge) {
      sourceBadge.textContent = result.source === 'api' ? '🤖 API' : '📝 local';
      sourceBadge.classList.toggle('is-api',   result.source === 'api');
      sourceBadge.classList.toggle('is-local', result.source !== 'api');
    }
    if (confidenceText) {
      const pct = Math.round((result.confidence ?? 0) * 100);
      confidenceText.textContent = `${pct}% confianza`;
      confidenceText.className = 'ai-confidence';
      if (pct >= 75)      confidenceText.classList.add('is-high');
      else if (pct >= 40) confidenceText.classList.add('is-medium');
      else                confidenceText.classList.add('is-low');
    }

    proposalEl?.classList.add('is-visible');

    // Check overlap immediately
    _checkOverlap();

    // Focus first incomplete field
    if (!result.date)            propDate?.focus();
    else if (!useStart)          propStart?.focus();
    else if (!propRespon?.value) propRespon?.focus();
    else                         btnSave?.focus();
  }

  function _hideProposal() {
    proposalEl?.classList.remove('is-visible');
    _setOverlapStatus('hidden');
    _validateProposal();
  }

  /* ── Field change listeners ── */
  propDate?.addEventListener('change', () => {
    _checkOverlap();
    // Re-render suggestions for new date
    if (suggestDate) suggestDate.value = propDate.value;
    _renderSuggestions(propDate.value);
  });
  propStart?.addEventListener('change', _checkOverlap);
  propEnd?.addEventListener('change',   _checkOverlap);
  propArea?.addEventListener('input', _validateProposal);

  propRespon?.addEventListener('change', () => {
    if (propRespon.value === '__new__') {
      newUserPanel?.classList.remove('hidden');
      newUserName?.focus();
    } else {
      newUserPanel?.classList.add('hidden');
    }
    _validateProposal();
  });

  btnNewUserCancel?.addEventListener('click', () => {
    if (propRespon) propRespon.value = '';
    newUserPanel?.classList.add('hidden');
    _validateProposal();
  });

  btnNewUserSave?.addEventListener('click', async () => {
    const name     = newUserName?.value?.trim();
    const email    = newUserEmail?.value?.trim();
    const password = newUserPwd?.value ?? '';
    const role     = newUserRole?.value ?? 'academico';

    if (!name || !email || password.length < 8) {
      Toast.show('Completa todos los campos. La contraseña debe tener al menos 8 caracteres.', 'error');
      return;
    }

    try {
      const created = await API.createUser({ name, email, password, role });
      _users.push(created);
      _populateResponsibleSelect();
      if (propRespon) propRespon.value = created.id;
      newUserPanel?.classList.add('hidden');
      Toast.show(`Usuario "${name}" creado.`, 'success');
      _validateProposal();
    } catch (err) {
      const msg = err.status === 409 ? 'El correo ya está registrado.' : 'Error al crear el usuario.';
      Toast.show(msg, 'error');
    }
  });

  /* ── Overlap check ── */
  function _checkOverlap() {
    const date  = propDate?.value;
    const start = propStart?.value;
    const end   = propEnd?.value;

    if (!date || !start || !end) {
      _setOverlapStatus('hidden');
      _validateProposal();
      return;
    }

    if (!Utils.isValidTimeRange(start, end)) {
      _setOverlapStatus('invalid');
      _validateProposal();
      return;
    }

    const conflict = Reservations.checkOverlap(date, start, end);
    if (conflict) {
      _setOverlapStatus('conflict', conflict);
    } else {
      _setOverlapStatus('available');
    }

    _validateProposal();
  }

  let _currentOverlapState = 'hidden';

  function _setOverlapStatus(state, conflict = null) {
    _currentOverlapState = state;
    if (!overlapEl) return;

    overlapEl.className = 'ai-overlap-status';
    overlapEl.classList.add(`is-${state}`);

    if (state === 'hidden') {
      if (overlapIcon) overlapIcon.innerHTML = '';
      if (overlapText) overlapText.textContent = '';
      return;
    }
    if (state === 'available') {
      if (overlapIcon) overlapIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
      if (overlapText) overlapText.textContent = 'Horario disponible';
    } else if (state === 'conflict') {
      if (overlapIcon) overlapIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      const who = conflict ? ` (${Utils.escapeHTML(Utils.truncate(conflict.responsible, 20))})` : '';
      if (overlapText) overlapText.textContent = `Traslape detectado${who}`;
    } else if (state === 'invalid') {
      if (overlapIcon) overlapIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      if (overlapText) overlapText.textContent = 'La hora de fin debe ser posterior a la de inicio';
    }
  }

  /* ── Validate all proposal fields → enable Save ── */
  function _validateProposal() {
    if (!btnSave) return;
    const ok = propDate?.value
            && propStart?.value
            && propEnd?.value
            && propRespon?.value && propRespon.value !== '__new__'
            && propArea?.value?.trim()
            && _currentOverlapState === 'available';
    btnSave.disabled = !ok;
  }

  /* ── Discard ── */
  btnDiscard?.addEventListener('click', () => {
    _hideProposal();
    inputEl?.focus();
  });

  /* ── Save proposal ── */
  btnSave?.addEventListener('click', _onSave);

  async function _onSave() {
    const data = {
      start_time:     `${propDate?.value}T${propStart?.value}:00`,
      end_time:       `${propDate?.value}T${propEnd?.value}:00`,
      responsible_id: propRespon?.value,
      area:           propArea?.value?.trim(),
      observations:   propObs?.value?.trim() ?? '',
    };

    const result = await Reservations.create(data);
    if (result.success) {
      Toast.show(`Reservación guardada para ${Utils.formatDateLong(propDate?.value)}.`, 'success');
      _hideProposal();
      if (inputEl) inputEl.value = '';
      // Clear suggestions
      if (suggestDate) suggestDate.value = '';
      if (suggestList) suggestList.innerHTML = '<p class="suggestions-empty">Selecciona una fecha para ver los horarios disponibles.</p>';
    } else if (result.error === 'overlap') {
      Toast.show('Traslape detectado. Ajusta el horario antes de guardar.', 'error');
      _setOverlapStatus('conflict', result.conflictWith);
    } else {
      Toast.show('Error al guardar la reservación.', 'error');
    }
  }

  /* ════════════════════════════════════════════════════════
     SMART SUGGESTIONS (HU-33)
  ════════════════════════════════════════════════════════ */

  suggestDate?.addEventListener('change', () => _renderSuggestions(suggestDate.value));

  function _renderSuggestions(date) {
    if (!suggestList) return;

    if (!date) {
      suggestList.innerHTML = '<p class="suggestions-empty">Selecciona una fecha para ver los horarios disponibles.</p>';
      return;
    }

    if (Utils.isWeekend(date)) {
      suggestList.innerHTML = '<p class="suggestions-empty">Los fines de semana no están disponibles para reservaciones.</p>';
      return;
    }

    const slots = AI.suggest(date, 60);

    if (!slots.length) {
      suggestList.innerHTML = '<p class="suggestions-empty">No hay horarios disponibles en esta fecha.</p>';
      return;
    }

    suggestList.innerHTML = slots.map(s => `
      <button class="suggestion-chip${s.isPreferred ? ' is-preferred' : ''}"
              data-start="${s.startTime}" data-end="${s.endTime}"
              type="button"
              aria-label="Usar horario ${s.label}">
        <span class="suggestion-chip__time">${s.label}</span>
        ${s.isPreferred ? '<span class="suggestion-chip__badge">Recomendado</span>' : ''}
      </button>`
    ).join('');

    suggestList.querySelectorAll('.suggestion-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        // Populate proposal if visible, else fill-in date/time for a new proposal
        const start = chip.dataset.start;
        const end   = chip.dataset.end;

        if (proposalEl?.classList.contains('is-visible')) {
          // Update proposal selects
          if (propDate) propDate.value = date;
          _setSelectValue(propStart, start);
          _setSelectValue(propEnd, end);
          _checkOverlap();
          propRespon?.focus();
        } else {
          // Pre-fill input with suggestion info
          if (inputEl) {
            inputEl.value = `Reservación el ${date} de ${start} a ${end}`;
          }
        }

        Toast.show(`Horario ${start}–${end} seleccionado.`, 'info');
      });
    });
  }

  /* ════════════════════════════════════════════════════════
     HELPERS
  ════════════════════════════════════════════════════════ */

  function _populateResponsibleSelect() {
    if (!propRespon) return;
    const current = propRespon.value;
    propRespon.innerHTML = '<option value="">— Selecciona un responsable —</option>';
    _users.filter(u => u.active !== false).forEach(u => {
      propRespon.add(new Option(`${u.name} (${u.role})`, u.id));
    });
    propRespon.add(new Option('+ Crear nuevo usuario…', '__new__'));
    if (current && current !== '__new__') propRespon.value = current;
  }

  function _tryMatchResponsible(aiName) {
    if (!aiName || !_users.length) return;
    const words = aiName.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    const match = _users.find(u =>
      words.some(w => u.name.toLowerCase().includes(w))
    );
    if (match) {
      if (propRespon) propRespon.value = match.id;
    } else {
      if (newUserName) newUserName.value = aiName;
      if (propRespon)  propRespon.value  = '__new__';
      newUserPanel?.classList.remove('hidden');
      Toast.show(`"${aiName}" no está registrado. Completa los datos o cancela para elegir un usuario existente.`, 'info');
    }
    _validateProposal();
  }

  function _setLoading(on, message = '') {
    loadingEl?.classList.toggle('is-visible', on);
    if (loadingText && message) loadingText.textContent = message;
    if (btnProcess) btnProcess.disabled = on;
  }

  function _populateTimeSelects() {
    const options = ['<option value="">— Selecciona —</option>'];
    for (let h = 7; h <= 21; h++) {
      for (const m of [0, 30]) {
        if (h === 21 && m === 30) break;
        const t = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        options.push(`<option value="${t}">${t}</option>`);
      }
    }
    const html = options.join('');
    if (propStart) propStart.innerHTML = html;
    if (propEnd)   propEnd.innerHTML   = html;
  }

  function _setSelectValue(selectEl, value) {
    if (!selectEl || !value) return;
    // Try exact match first; then round to nearest 30-min slot
    const opt = [...selectEl.options].find(o => o.value === value);
    if (opt) {
      selectEl.value = value;
      return;
    }
    // Round to nearest half-hour
    const [h, m] = value.split(':').map(Number);
    const rounded = m < 15 ? `${String(h).padStart(2, '0')}:00`
                  : m < 45 ? `${String(h).padStart(2, '0')}:30`
                  :           `${String(h + 1 > 21 ? h : h + 1).padStart(2, '0')}:00`;
    selectEl.value = rounded;
  }
});
