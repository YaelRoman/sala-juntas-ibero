/* ============================================================
   MODIFICATION-REQUEST-MODAL.JS
   Popup (cal-popup style) for requesting a time change on a
   reservation the current secretary does not own.
   ============================================================ */

const ModificationRequestModal = (() => {

  const POPUP_ID  = 'mod-req-popup';
  const POPUP_W   = 340;

  let _reservation = null;
  let _onSent      = null;

  /* ── Time slot helpers ── */
  const _timeSlots = () => {
    const opts = [];
    for (let h = 7; h < 21; h++) {
      for (const m of [0, 30]) {
        opts.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);
      }
    }
    return opts;
  };

  const _timeOptions = (selected) =>
    _timeSlots().map(t =>
      `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`
    ).join('');

  /* ── Render ── */
  const _render = (anchorRect) => {
    const r = _reservation;
    const dateISO  = r.date   ?? r.start_time?.slice(0, 10);
    const startVal = r.startTime ?? r.start_time?.slice(11, 16);
    const endVal   = r.endTime   ?? r.end_time?.slice(11, 16);

    const el = document.createElement('div');
    el.id        = POPUP_ID;
    el.className = 'cal-popup mod-req-popup';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', 'Solicitar cambio de horario');

    el.innerHTML = `
      <div class="cal-popup__header">
        <span class="cal-popup__title">Solicitar cambio de horario</span>
        <button class="cal-popup__close" id="mod-req-close" aria-label="Cerrar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="cal-popup__body" style="display:flex;flex-direction:column;gap:var(--space-3);">

        <!-- Current reservation (read-only) -->
        <div class="cal-popup__row" style="margin-bottom:0;">
          <svg class="cal-popup__icon" width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8"  y1="2" x2="8"  y2="6"/>
            <line x1="3"  y1="10" x2="21" y2="10"/>
          </svg>
          <div>
            <div class="cal-popup__label">${Utils.escapeHTML(r.responsible_name ?? r.responsible ?? '—')}</div>
            <div class="cal-popup__value">${Utils.escapeHTML(r.area ?? '—')}</div>
            <div class="cal-popup__value" style="font-size:var(--font-size-xs);margin-top:2px;">
              Actual: ${Utils.escapeHTML(dateISO)} ${Utils.escapeHTML(startVal)}–${Utils.escapeHTML(endVal)}
            </div>
          </div>
        </div>

        <hr style="border:none;border-top:1px solid var(--color-border);margin:0;" />

        <!-- New date -->
        <div>
          <label class="form-label" for="mod-req-date"
                 style="font-size:var(--font-size-xs);margin-bottom:var(--space-1);">Nueva fecha</label>
          <input type="date" id="mod-req-date" class="form-input"
                 value="${dateISO}" min="${Utils.today()}" />
        </div>

        <!-- New time -->
        <div>
          <label class="form-label"
                 style="font-size:var(--font-size-xs);margin-bottom:var(--space-1);">Nuevo horario</label>
          <div style="display:flex;align-items:center;gap:var(--space-2);">
            <select class="form-select" id="mod-req-start" aria-label="Hora inicio" style="flex:1;">
              ${_timeOptions(startVal)}
            </select>
            <span style="color:var(--color-secondary-light);font-size:var(--font-size-xs);">→</span>
            <select class="form-select" id="mod-req-end" aria-label="Hora fin" style="flex:1;">
              ${_timeOptions(endVal)}
            </select>
          </div>
          <div id="mod-req-overlap" class="rmodal__iv-overlap hidden" role="status" aria-live="polite"></div>
        </div>

        <!-- Reason -->
        <div>
          <label class="form-label" for="mod-req-reason"
                 style="font-size:var(--font-size-xs);margin-bottom:var(--space-1);">Motivo (opcional)</label>
          <textarea id="mod-req-reason" class="form-textarea" rows="2" maxlength="300"
                    placeholder="Explica brevemente el motivo del cambio…"
                    style="resize:none;"></textarea>
        </div>

      </div>

      <div class="cal-popup__actions" style="justify-content:flex-end;">
        <button type="button" class="btn btn-ghost btn-sm" id="mod-req-cancel">Cancelar</button>
        <button type="button" class="btn btn-primary btn-sm" id="mod-req-submit">Enviar solicitud</button>
      </div>`;

    document.body.appendChild(el);
    _position(el, anchorRect);
    _wireEvents(el);
    _checkOverlap();

    requestAnimationFrame(() => document.getElementById('mod-req-date')?.focus());
  };

  /* ── Position popup near anchor (same logic as reservation popup) ── */
  const _position = (el, anchorRect) => {
    if (!anchorRect) {
      // Fallback: center of screen
      el.style.left = `${Math.max(8, (window.innerWidth - POPUP_W) / 2)}px`;
      el.style.top  = `${Math.max(8, (window.innerHeight - el.offsetHeight) / 2)}px`;
      return;
    }
    let left = anchorRect.right + 8;
    let top  = anchorRect.top;
    if (left + POPUP_W > window.innerWidth - 8) left = anchorRect.left - POPUP_W - 8;
    if (left < 8) left = 8;

    // After render, adjust vertical if it overflows
    requestAnimationFrame(() => {
      const h = el.offsetHeight;
      if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
      if (top < 8) top = 8;
      el.style.top = `${top}px`;
    });
    el.style.left = `${left}px`;
    el.style.top  = `${anchorRect.top}px`;
  };

  /* ── Overlap check ── */
  const _checkOverlap = () => {
    const dateVal  = document.getElementById('mod-req-date')?.value;
    const startVal = document.getElementById('mod-req-start')?.value;
    const endVal   = document.getElementById('mod-req-end')?.value;
    const statusEl = document.getElementById('mod-req-overlap');
    if (!statusEl) return;

    if (!dateVal || !startVal || !endVal || startVal >= endVal) {
      statusEl.className = 'rmodal__iv-overlap hidden';
      return;
    }

    const conflict = Reservations.checkOverlap(dateVal, startVal, endVal, _reservation?.id ?? null);
    statusEl.classList.remove('hidden', 'is-conflict', 'is-available');
    if (conflict) {
      statusEl.classList.add('is-conflict');
      statusEl.innerHTML = `Traslape con <strong>${Utils.escapeHTML(conflict.responsible)}</strong> (${conflict.startTime}–${conflict.endTime})`;
    } else {
      statusEl.classList.add('is-available');
      statusEl.textContent = 'Horario disponible';
    }
  };

  /* ── Wire events ── */
  const _wireEvents = (el) => {
    document.getElementById('mod-req-close')?.addEventListener('click', close);
    document.getElementById('mod-req-cancel')?.addEventListener('click', close);
    document.getElementById('mod-req-start')?.addEventListener('change', _checkOverlap);
    document.getElementById('mod-req-end')?.addEventListener('change', _checkOverlap);
    document.getElementById('mod-req-date')?.addEventListener('change', _checkOverlap);
    document.getElementById('mod-req-submit')?.addEventListener('click', _submit);

    // Close on Escape or outside click
    const _onKey = (e) => { if (e.key === 'Escape') close(); };
    const _onOutside = (e) => { if (!el.contains(e.target)) close(); };
    document.addEventListener('keydown', _onKey);
    setTimeout(() => document.addEventListener('mousedown', _onOutside), 50);

    // Stash cleanup so close() can remove listeners
    el._cleanupListeners = () => {
      document.removeEventListener('keydown', _onKey);
      document.removeEventListener('mousedown', _onOutside);
    };
  };

  /* ── Submit ── */
  const _submit = async () => {
    const dateVal   = document.getElementById('mod-req-date')?.value;
    const startVal  = document.getElementById('mod-req-start')?.value;
    const endVal    = document.getElementById('mod-req-end')?.value;
    const reasonVal = document.getElementById('mod-req-reason')?.value?.trim();

    if (!dateVal) { Toast.show('Selecciona una fecha', 'warning'); return; }
    if (!startVal || !endVal || startVal >= endVal) {
      Toast.show('La hora de inicio debe ser anterior a la hora de fin', 'warning'); return;
    }

    const submitBtn = document.getElementById('mod-req-submit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Enviando…'; }

    try {
      await API.submitModificationRequest({
        reservation_id: _reservation.id,
        new_start_time: `${dateVal}T${startVal}:00`,
        new_end_time:   `${dateVal}T${endVal}:00`,
        reason: reasonVal || null,
      });
      const savedOnSent = _onSent;
      close();
      Toast.show('Solicitud enviada. Un administrador la revisará pronto.', 'success');
      savedOnSent?.();
    } catch (err) {
      const msg = err?.data?.error || err?.message || 'Error al enviar la solicitud';
      Toast.show(msg, 'error');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Enviar solicitud'; }
    }
  };

  /* ── Public API ── */
  const open = ({ reservation, onSent, anchorRect } = {}) => {
    close(); // close any existing instance
    _reservation = reservation;
    _onSent      = onSent ?? null;
    _render(anchorRect ?? null);
  };

  const close = () => {
    const el = document.getElementById(POPUP_ID);
    el?._cleanupListeners?.();
    el?.remove();
    _reservation = null;
    _onSent      = null;
  };

  return { open, close };
})();
