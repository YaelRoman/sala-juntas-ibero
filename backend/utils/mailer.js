const nodemailer = require('nodemailer');

const _enabled = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);

const transporter = _enabled
  ? nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    })
  : null;

const TZ = process.env.APP_TIMEZONE || 'America/Mexico_City';

// Escape user-controlled values before interpolating them into HTML email bodies.
function _esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _formatDate(value) {
  return new Date(value).toLocaleDateString('es-MX', {
    dateStyle: 'full',
    timeZone: TZ,
  });
}

function _formatTime(value) {
  return new Date(value).toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: TZ,
  });
}

function _layout(headerColor, title, body) {
  return `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
      <h2 style="color:${headerColor};">${title}</h2>
      ${body}
      <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0;" />
      <p style="font-size:12px;color:#888;">Universidad Iberoamericana — Sistema de Reservación de Sala de Juntas</p>
    </div>`;
}

function _reservationTable(reservation, includeObservations = true) {
  const date  = _formatDate(reservation.start_time);
  const start = _formatTime(reservation.start_time);
  const end   = _formatTime(reservation.end_time);
  return `
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#555;">Responsable</td><td style="padding:6px 0;font-weight:600;">${_esc(reservation.responsible_name)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Área</td><td style="padding:6px 0;">${_esc(reservation.area)}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Fecha</td><td style="padding:6px 0;">${date}</td></tr>
      <tr><td style="padding:6px 0;color:#555;">Horario</td><td style="padding:6px 0;">${start} – ${end}</td></tr>
      ${includeObservations && reservation.observations ? `<tr><td style="padding:6px 0;color:#555;">Observaciones</td><td style="padding:6px 0;">${_esc(reservation.observations)}</td></tr>` : ''}
    </table>`;
}

async function sendEmail(to, subject, html) {
  if (!_enabled) {
    console.log(`[Mailer] SMTP not configured — skipping email to ${to}: ${subject}`);
    return false;
  }
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
    });
    console.log(`[Mailer] Sent "${subject}" to ${to}`);
    return true;
  } catch (err) {
    console.error(`[Mailer] Failed to send "${subject}" to ${to}:`, err.message);
    return false;
  }
}

function reservationCreatedEmail(reservation) {
  return {
    subject: `Reservación confirmada — Sala de Juntas Ibero`,
    html: _layout('#ef3e42', 'Reservación confirmada',
      `<p>Se ha registrado una reservación de la Sala de Juntas con los siguientes datos:</p>
       ${_reservationTable(reservation, true)}`),
  };
}

function reservationUpdatedEmail(reservation, changes = []) {
  const changesHtml = changes.length
    ? `<p style="font-size:13px;color:#555;">Campos modificados: <strong>${_esc(changes.join(', '))}</strong>.</p>`
    : '';
  return {
    subject: `Reservación actualizada — Sala de Juntas Ibero`,
    html: _layout('#0277bd', 'Reservación actualizada',
      `<p>Se ha modificado una reservación de la Sala de Juntas. Datos actuales:</p>
       ${_reservationTable(reservation, true)}
       ${changesHtml}`),
  };
}

function reservationCancelledEmail(reservation) {
  return {
    subject: `Reservación cancelada — Sala de Juntas Ibero`,
    html: _layout('#dc3545', 'Reservación cancelada',
      `<p>La siguiente reservación ha sido cancelada:</p>
       ${_reservationTable(reservation, false)}`),
  };
}

function passwordResetEmail(resetLink) {
  return {
    subject: `Restablecer contraseña — Sala de Juntas Ibero`,
    html: _layout('#ef3e42', 'Restablecer contraseña',
      `<p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el botón para continuar:</p>
       <a href="${resetLink}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef3e42;color:white;text-decoration:none;border-radius:6px;font-weight:600;">
         Restablecer contraseña
       </a>
       <p style="font-size:13px;color:#555;">Este enlace expira en 1 hora. Si no solicitaste esto, ignora este correo.</p>`),
  };
}

function welcomeEmail(user, loginUrl) {
  return {
    subject: `Bienvenido — Sala de Juntas Ibero`,
    html: _layout('#ef3e42', 'Tu cuenta ha sido creada',
      `<p>Hola <strong>${_esc(user.name)}</strong>,</p>
       <p>Se ha creado una cuenta para ti en el sistema de Reservación de Sala de Juntas de la Universidad Iberoamericana.</p>
       <table style="width:100%;border-collapse:collapse;font-size:14px;">
         <tr><td style="padding:6px 0;color:#555;">Correo</td><td style="padding:6px 0;font-weight:600;">${_esc(user.email)}</td></tr>
         <tr><td style="padding:6px 0;color:#555;">Rol</td><td style="padding:6px 0;">${_esc(user.role)}</td></tr>
       </table>
       <p style="margin-top:16px;">La contraseña temporal te fue proporcionada por la persona que creó tu cuenta.</p>
       <a href="${_esc(loginUrl)}" style="display:inline-block;margin:16px 0;padding:12px 24px;background:#ef3e42;color:white;text-decoration:none;border-radius:6px;font-weight:600;">
         Iniciar sesión
       </a>`),
  };
}

function passwordChangedEmail(user) {
  return {
    subject: `Tu contraseña fue cambiada — Sala de Juntas Ibero`,
    html: _layout('#e65100', 'Tu contraseña fue cambiada',
      `<p>Hola <strong>${_esc(user.name)}</strong>,</p>
       <p>La contraseña de tu cuenta (<strong>${_esc(user.email)}</strong>) acaba de ser modificada.</p>
       <p style="font-size:13px;color:#555;">Si tú no realizaste este cambio, contacta inmediatamente a la administración del sistema.</p>`),
  };
}

function accountDeactivatedEmail(user) {
  return {
    subject: `Tu cuenta fue desactivada — Sala de Juntas Ibero`,
    html: _layout('#555555', 'Cuenta desactivada',
      `<p>Hola <strong>${_esc(user.name)}</strong>,</p>
       <p>Tu cuenta (<strong>${_esc(user.email)}</strong>) ha sido desactivada y ya no podrás iniciar sesión.</p>
       <p style="font-size:13px;color:#555;">Si crees que esto es un error, contacta a la administración del sistema.</p>`),
  };
}

function reservationAdminModifiedEmail(reservation, adminName, changes = []) {
  const changesHtml = changes.length
    ? `<p style="font-size:13px;color:#555;">Campos modificados: <strong>${_esc(changes.join(', '))}</strong>.</p>`
    : '';
  return {
    subject: `Tu reservación fue modificada por administración — Sala de Juntas Ibero`,
    html: _layout('#e65100', 'Reservación modificada por administración',
      `<p>El administrador <strong>${_esc(adminName)}</strong> modificó una reservación que registraste:</p>
       ${_reservationTable(reservation, true)}
       ${changesHtml}
       <p style="font-size:13px;color:#555;">Si tienes dudas, contacta a la administración del sistema.</p>`),
  };
}

function reservationAdminCancelledEmail(reservation, adminName) {
  return {
    subject: `Tu reservación fue cancelada por administración — Sala de Juntas Ibero`,
    html: _layout('#dc3545', 'Reservación cancelada por administración',
      `<p>El administrador <strong>${_esc(adminName)}</strong> canceló una reservación que registraste:</p>
       ${_reservationTable(reservation, false)}
       <p style="font-size:13px;color:#555;">Si tienes dudas, contacta a la administración del sistema.</p>`),
  };
}

function modificationRequestApprovedEmail(requesterName, reservation) {
  return {
    subject: `Solicitud de cambio aprobada — Sala de Juntas Ibero`,
    html: _layout('#2e7d32', 'Solicitud de cambio aprobada',
      `<p>Hola <strong>${_esc(requesterName)}</strong>,</p>
       <p>Tu solicitud de cambio de horario fue <strong>aprobada</strong>. Los datos actualizados de la reservación son:</p>
       ${_reservationTable(reservation, true)}`),
  };
}

function modificationRequestRejectedEmail(requesterName, reservation, reason) {
  return {
    subject: `Solicitud de cambio rechazada — Sala de Juntas Ibero`,
    html: _layout('#c62828', 'Solicitud de cambio rechazada',
      `<p>Hola <strong>${_esc(requesterName)}</strong>,</p>
       <p>Tu solicitud de cambio de horario para la siguiente reservación fue <strong>rechazada</strong>:</p>
       ${_reservationTable(reservation, false)}
       ${reason ? `<p style="font-size:13px;color:#555;">Motivo: ${_esc(reason)}</p>` : ''}`),
  };
}

module.exports = {
  sendEmail,
  reservationCreatedEmail,
  reservationUpdatedEmail,
  reservationCancelledEmail,
  reservationAdminModifiedEmail,
  reservationAdminCancelledEmail,
  modificationRequestApprovedEmail,
  modificationRequestRejectedEmail,
  passwordResetEmail,
  welcomeEmail,
  passwordChangedEmail,
  accountDeactivatedEmail,
};
