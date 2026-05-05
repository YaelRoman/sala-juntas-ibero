const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireSuperAdmin } = require('../middleware/requireRole');
const {
  sendEmail,
  welcomeEmail,
  passwordChangedEmail,
  accountDeactivatedEmail,
} = require('../utils/mailer');

const router = express.Router();

// All user routes require authentication
router.use(auth);

// GET /api/users - Get all users (any secretaria; management routes below are super-admin only)
router.get('/', requireRole('secretaria'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, email, role, is_admin, active, last_login, created_at
       FROM users ORDER BY name ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users - Create new user (any secretaria)
router.post('/', requireRole('secretaria'), async (req, res) => {
  const { name, email, password, role, is_admin } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, and role required' });
  }

  if (!['secretaria', 'academico'].includes(role)) {
    return res.status(400).json({ error: 'role must be "secretaria" or "academico"' });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }

  try {
    // Check if email exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, is_admin, active)
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING id, name, email, role, is_admin, active, created_at`,
      [name, email, passwordHash, role, is_admin || false]
    );

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'create_user', 'users', result.rows[0].id]
    );

    // Welcome email (non-blocking)
    const loginUrl = process.env.APP_URL || 'http://localhost:8080';
    const { subject, html } = welcomeEmail(result.rows[0], loginUrl);
    sendEmail(result.rows[0].email, subject, html);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/users/:id - Update user (super-admin only)
router.put('/:id', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, password, role, is_admin } = req.body;

  try {
    // Check if user exists
    const existing = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if email is already taken by another user
    if (email && email !== existing.rows[0].email) {
      const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (emailCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Email already exists' });
      }
    }

    let passwordHash = existing.rows[0].password_hash;
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ error: 'password must be at least 8 characters' });
      }
      passwordHash = await bcrypt.hash(password, 10);
    }

    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($2, name),
           email = COALESCE($3, email),
           password_hash = $4,
           role = COALESCE($5, role),
           is_admin = COALESCE($6, is_admin)
       WHERE id = $1
       RETURNING id, name, email, role, is_admin, active, created_at`,
      [id, name, email, passwordHash, role, is_admin]
    );

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'update_user', 'users', id]
    );

    // Notify on password change (non-blocking)
    if (password) {
      const { subject, html } = passwordChangedEmail(result.rows[0]);
      sendEmail(result.rows[0].email, subject, html);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/:id/deactivate - Deactivate user (super-admin only)
router.patch('/:id/deactivate', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  // Cannot deactivate self
  if (id === req.user.id) {
    return res.status(403).json({ error: 'Cannot deactivate yourself' });
  }

  try {
    const result = await pool.query(
      `UPDATE users SET active = false WHERE id = $1 RETURNING id, name, email, active`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'deactivate_user', 'users', id]
    );

    // Notify the deactivated user (non-blocking)
    const { subject, html } = accountDeactivatedEmail(result.rows[0]);
    sendEmail(result.rows[0].email, subject, html);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error deactivating user:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
