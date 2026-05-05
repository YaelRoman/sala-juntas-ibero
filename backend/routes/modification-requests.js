const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const { requireSuperAdmin } = require('../middleware/requireRole');
const {
  sendEmail,
  modificationRequestReceivedEmail,
  modificationRequestApprovedEmail,
  modificationRequestRejectedEmail,
  reservationUpdatedEmail,
  reservationAdminModifiedEmail,
} = require('../utils/mailer');

const router = express.Router();
router.use(auth);

// POST /api/modification-requests
// Secretary submits a request to change another secretary's reservation time
router.post('/', requireRole('secretaria'), async (req, res) => {
  const { reservation_id, new_start_time, new_end_time, reason } = req.body;

  if (!reservation_id || !new_start_time || !new_end_time) {
    return res.status(400).json({ error: 'reservation_id, new_start_time, and new_end_time are required' });
  }
  if (new_start_time >= new_end_time) {
    return res.status(400).json({ error: 'new_start_time must be before new_end_time' });
  }

  try {
    const resQ = await pool.query('SELECT * FROM reservations WHERE id = $1', [reservation_id]);
    if (resQ.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    const reservation = resQ.rows[0];

    if (reservation.status !== 'active') {
      return res.status(400).json({ error: 'Can only request changes on active reservations' });
    }

    // Requester must NOT be the owner (owners can edit directly)
    if (reservation.created_by === req.user.id) {
      return res.status(400).json({ error: 'You own this reservation — edit it directly' });
    }

    // Check proposed slot for conflicts (excluding the target reservation)
    const overlap = await pool.query(
      `SELECT id FROM reservations
       WHERE status = 'active' AND id != $1
       AND start_time < $3 AND end_time > $2`,
      [reservation_id, new_start_time, new_end_time]
    );
    if (overlap.rows.length > 0) {
      return res.status(409).json({ error: 'El horario solicitado ya está ocupado' });
    }

    // Check for existing pending request for same reservation by same user
    const pending = await pool.query(
      `SELECT id FROM modification_requests
       WHERE reservation_id = $1 AND requested_by = $2 AND status = 'pending'`,
      [reservation_id, req.user.id]
    );
    if (pending.rows.length > 0) {
      return res.status(409).json({ error: 'Ya tienes una solicitud pendiente para esta reservación' });
    }

    const result = await pool.query(
      `INSERT INTO modification_requests (reservation_id, requested_by, new_start_time, new_end_time, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [reservation_id, req.user.id, new_start_time, new_end_time, reason || null]
    );

    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'create_modification_request', 'modification_requests', result.rows[0].id]
    );

    // Notify all active super-admins (non-blocking)
    const adminsQ = await pool.query(
      `SELECT name, email FROM users WHERE is_admin = true AND active = true`
    );
    for (const admin of adminsQ.rows) {
      const { subject, html } = modificationRequestReceivedEmail(
        admin.name, req.user.name, reservation, new_start_time, new_end_time, reason
      );
      sendEmail(admin.email, subject, html);
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating modification request:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/modification-requests — super-admin sees all pending requests
router.get('/', requireSuperAdmin, async (req, res) => {
  const { status = 'pending' } = req.query;

  try {
    const result = await pool.query(
      `SELECT mr.*,
              r.responsible_name, r.area, r.start_time  AS current_start, r.end_time AS current_end,
              u.name AS requester_name, u.email AS requester_email
       FROM modification_requests mr
       JOIN reservations r ON r.id = mr.reservation_id
       JOIN users        u ON u.id = mr.requested_by
       WHERE mr.status = $1
       ORDER BY mr.created_at ASC`,
      [status]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching modification requests:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/modification-requests/:id/approve — super-admin approves
router.patch('/:id/approve', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const mrQ = await client.query('SELECT * FROM modification_requests WHERE id = $1', [id]);
    if (mrQ.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const mr = mrQ.rows[0];
    if (mr.status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Request is no longer pending' });
    }

    // Conflict check at approval time (slot may have been taken since submission)
    const overlap = await client.query(
      `SELECT id FROM reservations
       WHERE status = 'active' AND id != $1
       AND start_time < $3 AND end_time > $2`,
      [mr.reservation_id, mr.new_start_time, mr.new_end_time]
    );
    if (overlap.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'El horario solicitado ya no está disponible' });
    }

    // Apply the change
    const updated = await client.query(
      `UPDATE reservations
       SET start_time = $2, end_time = $3, last_modified_by = $4, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [mr.reservation_id, mr.new_start_time, mr.new_end_time, req.user.id]
    );

    // Mark request resolved
    await client.query(
      `UPDATE modification_requests
       SET status = 'approved', resolved_by = $2, resolved_at = NOW()
       WHERE id = $1`,
      [id, req.user.id]
    );

    await client.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'approve_modification_request', 'modification_requests', id]
    );

    await client.query('COMMIT');

    const reservation = updated.rows[0];

    // Email requester
    const requesterQ = await pool.query('SELECT name, email FROM users WHERE id = $1', [mr.requested_by]);
    if (requesterQ.rows[0]?.email) {
      const { subject, html } = modificationRequestApprovedEmail(requesterQ.rows[0].name, reservation);
      sendEmail(requesterQ.rows[0].email, subject, html);
    }

    // Email responsible person
    if (reservation.responsible_id) {
      const respQ = await pool.query('SELECT email FROM users WHERE id = $1', [reservation.responsible_id]);
      if (respQ.rows[0]?.email) {
        const { subject, html } = reservationUpdatedEmail(reservation, ['inicio', 'fin']);
        sendEmail(respQ.rows[0].email, subject, html);
      }
    }

    // Email creating secretary if different from requester (admin approved a 3rd party's request on their res)
    if (reservation.created_by && reservation.created_by !== mr.requested_by) {
      const creatorQ = await pool.query('SELECT email FROM users WHERE id = $1', [reservation.created_by]);
      if (creatorQ.rows[0]?.email) {
        const { subject, html } = reservationAdminModifiedEmail(reservation, req.user.name, ['inicio', 'fin']);
        sendEmail(creatorQ.rows[0].email, subject, html);
      }
    }

    res.json(reservation);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error approving modification request:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// PATCH /api/modification-requests/:id/reject — super-admin rejects
router.patch('/:id/reject', requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;

  try {
    const mrQ = await pool.query('SELECT * FROM modification_requests WHERE id = $1', [id]);
    if (mrQ.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    const mr = mrQ.rows[0];
    if (mr.status !== 'pending') {
      return res.status(400).json({ error: 'Request is no longer pending' });
    }

    await pool.query(
      `UPDATE modification_requests
       SET status = 'rejected', resolved_by = $2, resolved_at = NOW()
       WHERE id = $1`,
      [id, req.user.id]
    );

    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'reject_modification_request', 'modification_requests', id]
    );

    // Notify the requester
    const reservation = (await pool.query('SELECT * FROM reservations WHERE id = $1', [mr.reservation_id])).rows[0];
    const requesterQ = await pool.query('SELECT name, email FROM users WHERE id = $1', [mr.requested_by]);
    if (requesterQ.rows[0]?.email && reservation) {
      const { subject, html } = modificationRequestRejectedEmail(requesterQ.rows[0].name, reservation, reason);
      sendEmail(requesterQ.rows[0].email, subject, html);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Error rejecting modification request:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
