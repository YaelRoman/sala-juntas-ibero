const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db/pool');
const { sign } = require('../utils/jwt');
const auth = require('../middleware/auth');
const { sendEmail, passwordResetEmail } = require('../utils/mailer');

// 5 attempts per 15 min per IP. skipSuccessfulRequests means a legit user
// fat-fingering once doesn't burn quota — only failures count.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});

const RESET_TOKEN_TTL_MIN = 60;

function _hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const router = express.Router();

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, name, email, role, is_admin FROM users WHERE email = $1 AND active = true',
      [email]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordResult = await pool.query(
      'SELECT password_hash FROM users WHERE id = $1',
      [user.id]
    );

    const passwordHash = passwordResult.rows[0].password_hash;
    const validPassword = await bcrypt.compare(password, passwordHash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last_login and invalidate any outstanding password reset token
    await pool.query(
      `UPDATE users
          SET last_login = NOW(),
              reset_token_hash = NULL,
              reset_token_expires = NULL
        WHERE id = $1`,
      [user.id]
    );

    const token = sign({
      id: user.id,
      email: user.email,
      role: user.role,
      isAdmin: user.is_admin,
      name: user.name
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isAdmin: user.is_admin
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', auth, (req, res) => {
  // JWT is stateless, logout is client-side only
  return res.json({ ok: true });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    // Always return generic message (do not reveal user existence)
    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND active = true',
      [email]
    );

    if (result.rows.length > 0) {
      const userId = result.rows[0].id;

      // Generate a high-entropy token; store only its hash + expiry on the user row
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = _hashToken(token);
      const expires = new Date(Date.now() + RESET_TOKEN_TTL_MIN * 60 * 1000);

      await pool.query(
        `UPDATE users SET reset_token_hash = $2, reset_token_expires = $3 WHERE id = $1`,
        [userId, tokenHash, expires]
      );

      await pool.query(
        'INSERT INTO audit_log (user_id, action, entity) VALUES ($1, $2, $3)',
        [userId, 'password_reset_requested', 'user']
      );

      // Send password reset email (non-blocking)
      const base = process.env.APP_URL || 'http://localhost:8080';
      const resetLink = `${base}/reset-password.html?token=${token}`;
      const { subject, html } = passwordResetEmail(resetLink);
      sendEmail(email, subject, html);
    }

    // Always return success regardless
    return res.json({
      message: 'If the email exists in our system, a password reset link will be sent.'
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/reset-password/validate?token=...
// Lightweight check used by the reset page to know if it should show the form
router.get('/reset-password/validate', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ valid: false });
  }
  try {
    const tokenHash = _hashToken(token);
    const result = await pool.query(
      `SELECT id FROM users
        WHERE reset_token_hash = $1
          AND reset_token_expires > NOW()
          AND active = true`,
      [tokenHash]
    );
    return res.json({ valid: result.rows.length > 0 });
  } catch (err) {
    console.error('Validate reset token error:', err);
    return res.status(500).json({ valid: false });
  }
});

// POST /api/auth/reset-password { token, password }
router.post('/reset-password', authLimiter, async (req, res) => {
  const { token, password } = req.body || {};

  if (!token || !password) {
    return res.status(400).json({ error: 'token and password required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    const tokenHash = _hashToken(token);
    const userResult = await pool.query(
      `SELECT id, name, email FROM users
        WHERE reset_token_hash = $1
          AND reset_token_expires > NOW()
          AND active = true`,
      [tokenHash]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const user = userResult.rows[0];

    const passwordHash = await bcrypt.hash(password, 10);
    await pool.query(
      `UPDATE users
          SET password_hash = $2,
              reset_token_hash = NULL,
              reset_token_expires = NULL
        WHERE id = $1`,
      [user.id, passwordHash]
    );

    await pool.query(
      'INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES ($1, $2, $3, $4)',
      [user.id, 'password_reset_completed', 'user', user.id]
    );

    // Notify user of the change (non-blocking)
    const { passwordChangedEmail } = require('../utils/mailer');
    const { subject, html } = passwordChangedEmail(user);
    sendEmail(user.email, subject, html);

    return res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/test-email  (auth required — sends test email to the logged-in user)
router.post('/test-email', auth, async (req, res) => {
  const { sendEmail } = require('../utils/mailer');
  const to = req.user.email;

  const smtpConfig = {
    host:     process.env.SMTP_HOST     || '(not set)',
    port:     process.env.SMTP_PORT     || '(not set)',
    user:     process.env.SMTP_USER     || '(not set)',
    from:     process.env.SMTP_FROM     || process.env.SMTP_USER || '(not set)',
    enabled:  !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD),
  };

  if (!smtpConfig.enabled) {
    return res.status(503).json({
      ok: false,
      error: 'SMTP not configured — SMTP_HOST, SMTP_USER or SMTP_PASSWORD missing in .env',
      config: smtpConfig,
    });
  }

  const sent = await sendEmail(
    to,
    'Prueba de correo — Sala de Juntas Ibero',
    `<div style="font-family:sans-serif;max-width:520px;margin:auto;padding:24px;">
       <h2 style="color:#ef3e42;">Prueba de correo ✓</h2>
       <p>Este correo confirma que la configuración SMTP funciona correctamente.</p>
       <table style="font-size:13px;border-collapse:collapse;width:100%;">
         <tr><td style="padding:4px 0;color:#555;">Host</td><td>${smtpConfig.host}:${smtpConfig.port}</td></tr>
         <tr><td style="padding:4px 0;color:#555;">Usuario</td><td>${smtpConfig.user}</td></tr>
         <tr><td style="padding:4px 0;color:#555;">From</td><td>${smtpConfig.from}</td></tr>
       </table>
       <hr style="margin:20px 0;border:none;border-top:1px solid #e0e0e0;"/>
       <p style="font-size:12px;color:#888;">Universidad Iberoamericana — Sistema de Reservación de Sala de Juntas</p>
     </div>`
  );

  if (sent) {
    return res.json({ ok: true, message: `Test email sent to ${to}`, config: smtpConfig });
  } else {
    return res.status(502).json({
      ok: false,
      error: 'SMTP send failed — check backend logs for details',
      config: smtpConfig,
    });
  }
});

module.exports = router;
