/* ============================================================
   HISTORY-PAGE.JS — Historial y eliminación masiva de reservaciones
   HU-12 (eliminación masiva), HU-20 (historial),
   HU-11 (cancelar individual), HU-26 (búsqueda/filtros)
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  // 1. Auth
  Store.init();
  const user = Auth.requireAuth();
  if (!user) return;

  // Load fresh data from API
  try {
    const reservations = await API.getReservations();
    Store.setState({ reservations });
  } catch (err) {
    console.error('Error loading reservations:', err);
    Toast.show('Error cargando datos', 'error');
  }

  const isSecretary = user.role === 'secretaria';

  // 2. Sidebar + badge
  Sidebar.init('historial');
  Auth.startInactivityWatcher();

  const badge = document.getElementById('topbar-role-badge');
  if (badge) {
    badge.textContent = isSecretary ? 'Secretaria' : 'Académico';
    badge.className   = `badge ${isSecretary ? 'badge-primary' : 'badge-info'} topbar__badge-role`;
  }

  // Ocultar columnas de acción para académico
  if (!isSecretary) {
    document.getElementById('select-all-top')?.closest('th')?.remove();
  }

  /* ── ESTADO ── */
  let _filtered  = [];
  let _selected  = new Set();
  let _sortField = 'date';
  let _sortDir   = 'desc';

  /* ── REFERENCIAS ── */
  const filterSearch   = document.getElementById('filter-search');
  const filterDateFrom = document.getElementById('filter-date-from');
  const filterDateTo   = document.getElementById('filter-date-to');
  const filterStatus   = document.getElementById('filter-status');
  const btnClear       = document.getElementById('btn-clear-filters');
  const selectAllTop   = document.getElementById('select-all-top');
  const bulkBar        = document.getElementById('bulk-bar');
  const selectAllChk   = document.getElementById('select-all-chk');
  const bulkCount      = document.getElementById('bulk-count');
  const selCount       = document.getElementById('selection-count');
  const btnBulkCancel  = document.getElementById('btn-bulk-cancel');
  const tableBody      = document.getElementById('table-body');
  const tableEmpty     = document.getElementById('table-empty');
  const tableFooter    = document.getElementById('table-footer');

  /* ── FILTROS ── */
  filterSearch?.addEventListener('input',  _applyFilters);
  filterStatus?.addEventListener('change', _applyFilters);
  filterDateFrom?.addEventListener('change', _applyFilters);
  filterDateTo?.addEventListener('change',   _applyFilters);

  btnClear?.addEventListener('click', () => {
    if (filterSearch)   filterSearch.value   = '';
    if (filterDateFrom) filterDateFrom.value = '';
    if (filterDateTo)   filterDateTo.value   = '';
    if (filterStatus)   filterStatus.value   = 'all';
    _applyFilters();
  });

  /* ── COLUMNAS ORDENABLES ── */
  document.querySelectorAll('.data-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      _sortDir    = _sortField === field && _sortDir === 'asc' ? 'desc' : 'asc';
      _sortField  = field;
      _updateSortIndicators();
      _renderTable();
    });
  });

  /* ── SELECT ALL (cabecera de tabla) ── */
  selectAllTop?.addEventListener('change', () => {
    _filtered.filter(r => r.status === 'active').forEach(r => {
      if (selectAllTop.checked) _selected.add(r.id);
      else                      _selected.delete(r.id);
    });
    _renderTable();
    _updateBulkBar();
  });

  /* ── SELECT ALL (bulk bar) ── */
  selectAllChk?.addEventListener('change', () => {
    _filtered.filter(r => r.status === 'active').forEach(r => {
      if (selectAllChk.checked) _selected.add(r.id);
      else                      _selected.delete(r.id);
    });
    _renderTable();
    _updateBulkBar();
  });

  /* ── BULK CANCEL ── */
  btnBulkCancel?.addEventListener('click', () => {
    const count = _selected.size;
    if (!count) return;
    _showConfirmModal(
      'Cancelar reservaciones',
      `¿Confirmas la cancelación de <strong>${count} reservación${count !== 1 ? 'es' : ''}</strong>?<br>
       Esta acción se registrará en el historial y no se puede deshacer.`,
      () => {
        const cancelled = Reservations.bulkCancel([..._selected]);
        _selected.clear();
        Toast.show(
          `${cancelled} reservación${cancelled !== 1 ? 'es canceladas' : ' cancelada'} correctamente.`,
          'success'
        );
        _applyFilters();
      }
    );
  });

  /* ════════════════════════════════════════
     FILTRADO
     ════════════════════════════════════════ */
  function _applyFilters() {
    const search   = Utils.normalize(filterSearch?.value  ?? '');
    const dateFrom = filterDateFrom?.value ?? '';
    const dateTo   = filterDateTo?.value   ?? '';
    const status   = filterStatus?.value   ?? 'all';

    const all = Store.getState().reservations;

    _filtered = all.filter(r => {
      if (status !== 'all' && r.status !== status) return false;
      if (dateFrom && r.date < dateFrom)           return false;
      if (dateTo   && r.date > dateTo)             return false;
      if (search) {
        const hay = Utils.normalize(
          `${r.responsible} ${r.area} ${r.observations ?? ''}`
        );
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Descartar selecciones que ya no están en el filtro
    _selected = new Set([..._selected].filter(id =>
      _filtered.some(r => r.id === id && r.status === 'active')
    ));

    _renderTable();
    _updateBulkBar();
  }

  /* ════════════════════════════════════════
     RENDER TABLA
     ════════════════════════════════════════ */
  function _renderTable() {
    const sorted = [..._filtered].sort((a, b) => {
      let va = (a[_sortField] ?? '').toString().toLowerCase();
      let vb = (b[_sortField] ?? '').toString().toLowerCase();
      if (va < vb) return _sortDir === 'asc' ? -1 :  1;
      if (va > vb) return _sortDir === 'asc' ?  1 : -1;
      return 0;
    });

    if (!sorted.length) {
      tableBody.innerHTML = '';
      tableEmpty?.classList.remove('hidden');
      if (tableFooter) tableFooter.textContent = '';
      return;
    }

    tableEmpty?.classList.add('hidden');
    if (tableFooter) {
      tableFooter.textContent =
        `Mostrando ${sorted.length} reservación${sorted.length !== 1 ? 'es' : ''}`;
    }

    tableBody.innerHTML = sorted.map(r => _buildRow(r)).join('');

    // Wire checkboxes
    tableBody.querySelectorAll('.row-check').forEach(chk => {
      chk.addEventListener('change', () => {
        if (chk.checked) _selected.add(chk.dataset.id);
        else             _selected.delete(chk.dataset.id);
        const row = chk.closest('tr');
        row?.classList.toggle('is-selected', chk.checked);
        _updateBulkBar();
        _syncSelectAll();
      });
    });

    // Wire individual edit
    tableBody.querySelectorAll('.row-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = Store.getState().reservations.find(res => res.id === parseInt(btn.dataset.id, 10));
        if (!r) return;
        ReservationModal.open({
          editReservation: r,
          onSaved: () => _renderTable(),
        });
      });
    });

    // Wire individual cancel
    tableBody.querySelectorAll('.row-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => _onRowCancel(btn.dataset.id));
    });

    _syncSelectAll();
  }

  function _buildRow(r) {
    const isActive = r.status === 'active';
    const isSel    = _selected.has(r.id);

    const rowCls = [
      isSel     ? 'is-selected'  : '',
      !isActive ? 'is-cancelled' : '',
    ].filter(Boolean).join(' ');

    const statusBadge = isActive
      ? `<span class="badge badge-success">Activa</span>`
      : r.status === 'cancelled'
        ? `<span class="badge badge-neutral">Cancelada</span>`
        : `<span class="badge badge-info">Pasada</span>`;

    const checkCell = isSecretary && isActive
      ? `<td class="col-check">
           <input type="checkbox" class="row-check" data-id="${r.id}"
                  ${isSel ? 'checked' : ''}
                  aria-label="Seleccionar reservación de ${Utils.escapeHTML(r.responsible)}" />
         </td>`
      : `<td class="col-check"></td>`;

    const actions = isSecretary && isActive
      ? `<div class="row-actions">
           <button class="btn btn-secondary btn-sm row-edit-btn" data-id="${r.id}"
                   aria-label="Editar reservación de ${Utils.escapeHTML(r.responsible)}">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2.5"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
               <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
               <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
             </svg>
           </button>
           <button class="btn btn-danger btn-sm row-cancel-btn" data-id="${r.id}"
                   aria-label="Cancelar reservación de ${Utils.escapeHTML(r.responsible)}">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2.5"
                  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
               <line x1="18" y1="6" x2="6" y2="18"/>
               <line x1="6"  y1="6" x2="18" y2="18"/>
             </svg>
           </button>
         </div>`
      : `<span style="color:var(--color-secondary-light);font-size:var(--font-size-xs);">—</span>`;

    return `
      <tr class="${rowCls}" data-id="${r.id}">
        ${checkCell}
        <td style="white-space:nowrap;">${Utils.formatDateShort(r.date)}</td>
        <td><span class="row-name">${Utils.escapeHTML(r.responsible)}</span></td>
        <td>${Utils.escapeHTML(Utils.truncate(r.area, 32))}</td>
        <td style="white-space:nowrap;">${r.startTime}–${r.endTime}</td>
        <td>${statusBadge}</td>
        <td class="col-actions">${actions}</td>
      </tr>`;
  }

  /* ── CANCELAR FILA INDIVIDUAL ── */
  function _onRowCancel(id) {
    const r = Reservations.getById(id);
    if (!r) return;
    _showConfirmModal(
      'Cancelar reservación',
      `¿Cancelar la reservación de <strong>${Utils.escapeHTML(r.responsible)}</strong><br>
       el ${Utils.formatDateLong(r.date)}, ${r.startTime}–${r.endTime}?`,
      () => {
        Reservations.cancel(id);
        _selected.delete(id);
        Toast.show('Reservación cancelada.', 'success');
        _applyFilters();
      }
    );
  }

  /* ════════════════════════════════════════
     HELPERS DE UI
     ════════════════════════════════════════ */

  function _updateBulkBar() {
    const count = _selected.size;
    bulkBar?.classList.toggle('hidden', count === 0 || !isSecretary);
    if (bulkCount) bulkCount.textContent = count;
    if (selCount)  selCount.textContent  = `${count} seleccionada${count !== 1 ? 's' : ''}`;
  }

  function _syncSelectAll() {
    const activeInFilter  = _filtered.filter(r => r.status === 'active').length;
    const selectedCount   = [..._selected].filter(id =>
      _filtered.some(r => r.id === id && r.status === 'active')
    ).length;

    const indeterminate = selectedCount > 0 && selectedCount < activeInFilter;
    const checked       = activeInFilter > 0 && selectedCount === activeInFilter;

    [selectAllTop, selectAllChk].forEach(el => {
      if (!el) return;
      el.indeterminate = indeterminate;
      el.checked       = checked;
    });
  }

  function _updateSortIndicators() {
    document.querySelectorAll('.data-table th.sortable').forEach(th => {
      th.dataset.sortDir = th.dataset.sort === _sortField ? _sortDir : '';
    });
  }

  /* ── MODAL DE CONFIRMACIÓN ── */
  function _showConfirmModal(title, message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'conf-title');

    overlay.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <svg width="18" height="18" class="modal-header__icon" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9"  x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <h3 id="conf-title">${Utils.escapeHTML(title)}</h3>
        </div>
        <div class="modal-body"><p>${message}</p></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="conf-cancel-btn">Cancelar</button>
          <button class="btn btn-danger"    id="conf-ok-btn">Confirmar</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    overlay.querySelector('#conf-cancel-btn').addEventListener('click', close);
    overlay.querySelector('#conf-ok-btn').addEventListener('click', () => {
      close();
      onConfirm();
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    const esc = (e) => {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); }
    };
    document.addEventListener('keydown', esc);

    overlay.querySelector('#conf-ok-btn').focus();
  }

  /* ── EXPORT BUTTONS ── */
  if (isSecretary) {
    document.getElementById('export-btn-group')?.style.setProperty('display', '');
    Export.attachExportButtons({
      pdfBtnId:        'btn-export-pdf',
      excelBtnId:      'btn-export-excel',
      csvBtnId:        'btn-export-csv',
      getReservations: () => _filtered,
      getOpts:         () => ({
        title:    'Reservaciones — Sala de Juntas Ibero',
        dateFrom: filterDateFrom?.value ?? '',
        dateTo:   filterDateTo?.value   ?? '',
      }),
    });
  }

  /* ── INICIO ── */
  _updateSortIndicators();
  _applyFilters();
});
