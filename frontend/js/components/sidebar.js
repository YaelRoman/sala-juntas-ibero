/* ============================================================
   SIDEBAR.JS — Componente de navegación compartido
   Se inyecta en cada página; maneja activo, roles, mobile toggle
   Plataforma Reservación Sala de Juntas · Ibero CDMX
   ============================================================ */

const Sidebar = (() => {

  /* ── DEFINICIÓN DE ITEMS DE NAVEGACIÓN ── */
  const _buildSecretariaNav = (isAdmin) => [
    {
      label: 'Principal',
      items: [
        { id: 'dashboard', href: 'dashboard.html', label: 'Dashboard', icon: 'grid' },
      ]
    },
    {
      label: 'Gestión',
      items: [
        { id: 'historial',    href: 'historial.html',    label: 'Historial',    icon: 'file-text'     },
        { id: 'estadisticas', href: 'estadisticas.html', label: 'Estadísticas', icon: 'bar-chart-2'   },
        { id: 'ai-panel',     href: 'ai-panel.html',     label: 'Asistente IA', icon: 'message-square' },
      ]
    },
    {
      label: 'Administración',
      items: [
        ...(isAdmin ? [
          { id: 'admin-users',     href: 'admin.html#usuarios',        label: 'Usuarios',          icon: 'users'    },
          { id: 'admin-requests',  href: 'admin.html#solicitudes',     label: 'Solicitudes',       icon: 'inbox'    },
        ] : []),
        { id: 'admin-config',  href: 'admin.html#calendario',    label: 'Festivos / Cierres', icon: 'settings' },
        { id: 'admin-notif',   href: 'admin.html#notificaciones', label: 'Notificaciones',    icon: 'bell'     },
        { id: 'admin-backup',  href: 'admin.html#respaldos',     label: 'Respaldos',         icon: 'download' },
      ]
    }
  ];

  const NAV = {
    academico: [
      {
        label: 'Principal',
        items: [
          { id: 'calendar',  href: 'calendar.html',  label: 'Calendario', icon: 'calendar'   },
          { id: 'historial', href: 'historial.html', label: 'Historial',  icon: 'file-text'  },
        ]
      }
    ]
  };

  /* ── ÍCONOS SVG (inline, Feather-style) ── */
  const ICONS = {
    grid: `<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>`,
    calendar: `<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
    'plus-circle': `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>`,
    'file-text': `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>`,
    'bar-chart-2': `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>`,
    'message-square': `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    users: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    settings: `<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93l-1.41 1.41M5.34 18.66l-1.41 1.41M21 12h-2M5 12H3M19.07 19.07l-1.41-1.41M5.34 5.34L3.93 3.93M12 19v2M12 3v2"/>`,
    'log-out':  `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
    download:   `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>`,
    bell:       `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
    inbox:      `<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
  };

  const _icon = (name) =>
    `<svg class="nav-item__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
       ${ICONS[name] || ''}
     </svg>`;

  /* ── RENDER ── */
  const _buildHTML = (user, activeId) => {
    const role     = user?.role || 'academico';
    const isAdmin  = !!user?.isAdmin;
    const sections = role === 'secretaria' ? _buildSecretariaNav(isAdmin) : (NAV[role] || NAV.academico);
    const initials  = (user?.name || '?').charAt(0).toUpperCase();
    const roleLabel = isAdmin ? 'Super Admin' : (role === 'secretaria' ? 'Secretaria' : 'Académico');

    const navHTML = sections.map(section => `
      <div class="sidebar__nav-section">
        <p class="sidebar__nav-label">${section.label}</p>
        ${section.items.map(item => `
          <a href="${item.href}"
             class="nav-item${item.id === activeId ? ' active' : ''}"
             ${item.id === activeId ? 'aria-current="page"' : ''}>
            ${_icon(item.icon)}
            ${item.label}
          </a>`).join('')}
      </div>`).join('');

    return `
      <a class="sidebar__brand" href="${role === 'secretaria' ? 'dashboard.html' : 'calendar.html'}"
         aria-label="Ir al inicio">
        <img src="assets/img/logo-ibero-white.png"
             alt="Universidad Iberoamericana"
             class="sidebar__brand-img" />
      </a>

      <nav class="sidebar__nav" aria-label="Menú principal">
        ${navHTML}
      </nav>

      <div class="sidebar__user">
        <div class="sidebar__user-avatar" aria-hidden="true">${initials}</div>
        <div class="sidebar__user-info">
          <p class="sidebar__user-name">${Utils.escapeHTML(user?.name || '—')}</p>
          <p class="sidebar__user-role">${roleLabel}</p>
        </div>
        <button class="sidebar__logout" id="logout-btn"
                title="Cerrar sesión" aria-label="Cerrar sesión">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            ${ICONS['log-out']}
          </svg>
        </button>
      </div>`;
  };

  /* ── INIT ── */
  /**
   * @param {string} activeId  — ID del item activo ('dashboard', 'calendar', etc.)
   * @param {string} [mountId] — ID del elemento contenedor (default: 'sidebar')
   */
  const init = (activeId, mountId = 'sidebar') => {
    const user    = Store.getUser();
    const mountEl = document.getElementById(mountId);
    if (!mountEl) return;

    mountEl.innerHTML = _buildHTML(user, activeId);

    // Logout
    document.getElementById('logout-btn')?.addEventListener('click', Auth.logout);

    // Mobile toggle
    _initMobileToggle(mountId);
  };

  /* ── MOBILE TOGGLE ── */
  const _initMobileToggle = (sidebarId) => {
    const toggleBtn = document.getElementById('sidebar-toggle');
    const sidebar   = document.getElementById(sidebarId);
    const overlay   = document.getElementById('sidebar-overlay');
    if (!toggleBtn || !sidebar) return;

    const open  = () => {
      sidebar.classList.add('is-open');
      overlay?.classList.add('is-visible');
      toggleBtn.setAttribute('aria-expanded', 'true');
      // Trap focus inside sidebar on mobile
      sidebar.querySelector('a, button')?.focus();
    };

    const close = () => {
      sidebar.classList.remove('is-open');
      overlay?.classList.remove('is-visible');
      toggleBtn.setAttribute('aria-expanded', 'false');
    };

    toggleBtn.addEventListener('click', () =>
      sidebar.classList.contains('is-open') ? close() : open()
    );

    overlay?.addEventListener('click', close);

    // Close with Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && sidebar.classList.contains('is-open')) close();
    });

    // Close sidebar on nav-item click (mobile)
    sidebar.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 768) close();
      });
    });
  };

  return { init };
})();
