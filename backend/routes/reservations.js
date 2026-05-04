const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const {
  sendEmail,
  reservationCreatedEmail,
  reservationUpdatedEmail,
  reservationCancelledEmail,
} = require('../utils/mailer');

const router = express.Router();

// All reservations routes require authentication
router.use(auth);

// POST /api/reservations/recurring-group - Create recurring group (for HU-27)
router.post('/recurring-group', requireRole('secretaria'), async (req, res) => {
  const { pattern, endDate, maxOccurrences } = req.body;

  if (!pattern || !['daily', 'weekly', 'biweekly', 'monthly'].includes(pattern)) {
    return res.status(400).json({ error: 'Invalid pattern' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO recurring_groups (pattern, end_date, max_occurrences)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [pattern, endDate || null, maxOccurrences || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating recurring group:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reservations - Get all reservations with optional filters
router.get('/', async (req, res) => {
  const { status, dateFrom, dateTo, responsible } = req.query;

  try {
    let query = 'SELECT * FROM reservations WHERE 1=1';
    const params = [];
    let paramCount = 1;

    if (status) {
      query += ` AND status = $${paramCount}`;
      params.push(status);
      paramCount++;
    }

    if (dateFrom) {
      query += ` AND start_time >= $${paramCount}`;
      params.push(dateFrom);
      paramCount++;
    }

    if (dateTo) {
      query += ` AND end_time <= $${paramCount}`;
      params.push(dateTo);
      paramCount++;
    }

    if (responsible) {
      query += ` AND responsible_name ILIKE $${paramCount}`;
      params.push(`%${responsible}%`);
      paramCount++;
    }

    query += ' ORDER BY start_time ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching reservations:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reservations/week?date=YYYY-MM-DD - Get all reservations in the week containing the given date (Mon-Sun)
router.get('/week', async (req, res) => {
  const { date } = req.query;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'date (YYYY-MM-DD) required' });
  }

  // Compute Monday of the week containing `date` and the Monday of the next week.
  const ref = new Date(`${date}T00:00:00Z`);
  const dow = ref.getUTCDay();                    // 0=Sun … 6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const weekStart = new Date(ref);
  weekStart.setUTCDate(ref.getUTCDate() + diffToMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

  try {
    const result = await pool.query(
      `SELECT * FROM reservations
       WHERE start_time >= $1 AND start_time < $2
       ORDER BY start_time ASC`,
      [weekStart.toISOString(), weekEnd.toISOString()]
    );
    res.json({
      weekStart: weekStart.toISOString().slice(0, 10),
      reservations: result.rows
    });
  } catch (err) {
    console.error('Error fetching week reservations:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/reservations/multi - Create multiple reservations in one logical booking (secretaria only)
router.post('/multi', requireRole('secretaria'), async (req, res) => {
  const { intervals, responsible_id, area, observations } = req.body || {};

  if (!Array.isArray(intervals) || intervals.length === 0) {
    return res.status(400).json({ error: 'intervals[] is required' });
  }
  if (!responsible_id || !area) {
    return res.status(400).json({ error: 'responsible_id and area are required' });
  }
  for (const it of intervals) {
    if (!it?.start_time || !it?.end_time) {
      return res.status(400).json({ error: 'each interval needs start_time and end_time' });
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Look up responsible user
    const userResult = await client.query(
      'SELECT id, name, email FROM users WHERE id = $1 AND active = true',
      [responsible_id]
    );
    if (userResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Responsible user not found' });
    }
    const responsible = userResult.rows[0];

    // Conflict check across all intervals (incl. against each other)
    for (let i = 0; i < intervals.length; i++) {
      const a = intervals[i];
      // Self-overlap within payload
      for (let j = i + 1; j < intervals.length; j++) {
        const b = intervals[j];
        if (a.start_time < b.end_time && a.end_time > b.start_time) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: 'Selected intervals overlap each other' });
        }
      }
      // Overlap with existing active reservations
      const overlap = await client.query(
        `SELECT id, responsible_name, start_time, end_time
         FROM reservations
         WHERE status = 'active'
         AND start_time < $2 AND end_time > $1
         LIMIT 1`,
        [a.start_time, a.end_time]
      );
      if (overlap.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'overlap',
          message: 'Time slot is already booked',
          conflictWith: overlap.rows[0],
          intervalIndex: i,
        });
      }
    }

    // Generate one grouped_id when there are 2+ intervals
    const groupedRow = intervals.length > 1
      ? await client.query('SELECT gen_random_uuid() AS id')
      : null;
    const groupedId = groupedRow ? groupedRow.rows[0].id : null;

    const created = [];
    for (const it of intervals) {
      const ins = await client.query(
        `INSERT INTO reservations (
          responsible_id, responsible_name, area, start_time, end_time,
          observations, grouped_id, created_by, last_modified_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          responsible.id,
          responsible.name,
          area,
          it.start_time,
          it.end_time,
          (observations ?? '').trim() || null,
          groupedId,
          req.user.id,
          req.user.id,
        ]
      );
      created.push(ins.rows[0]);

      await client.query(
        `INSERT INTO audit_log (user_id, action, entity, entity_id)
         VALUES ($1, $2, $3, $4)`,
        [req.user.id, 'create_reservation', 'reservations', ins.rows[0].id]
      );
    }

    await client.query('COMMIT');

    // Confirmation email per interval (non-blocking)
    if (responsible.email) {
      for (const r of created) {
        const { subject, html } = reservationCreatedEmail(r);
        sendEmail(responsible.email, subject, html);
      }
    }

    res.status(201).json({ reservations: created, grouped_id: groupedId });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error creating multi reservation:', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/reservations/:id - Get single reservation
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error fetching reservation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/reservations - Create new reservation (secretaria only)
router.post('/', requireRole('secretaria'), async (req, res) => {
  const {
    responsible_id,
    area,
    start_time,
    end_time,
    observations,
    is_recurring,
    recurring_group
  } = req.body;

  if (!responsible_id || !area || !start_time || !end_time) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Look up responsible user
    const userResult = await pool.query(
      'SELECT id, name, email FROM users WHERE id = $1 AND active = true',
      [responsible_id]
    );
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Responsible user not found' });
    }
    const responsible = userResult.rows[0];

    // Check for overlap with active reservations
    const overlapCheck = await pool.query(
      `SELECT id, responsible_name, start_time, end_time
       FROM reservations
       WHERE status = 'active'
       AND start_time < $2
       AND end_time > $1`,
      [start_time, end_time]
    );

    if (overlapCheck.rows.length > 0) {
      return res.status(409).json({
        error: 'overlap',
        message: 'Time slot is already booked',
        conflictWith: overlapCheck.rows[0]
      });
    }

    // Create reservation
    const result = await pool.query(
      `INSERT INTO reservations (
        responsible_id, responsible_name, area, start_time, end_time,
        observations, is_recurring, recurring_group, created_by, last_modified_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        responsible.id,
        responsible.name,
        area,
        start_time,
        end_time,
        observations || null,
        is_recurring || false,
        recurring_group || null,
        req.user.id,
        req.user.id
      ]
    );

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'create_reservation', 'reservations', result.rows[0].id]
    );

    // Send confirmation email to responsible person (non-blocking)
    const { subject, html } = reservationCreatedEmail(result.rows[0]);
    sendEmail(responsible.email, subject, html);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating reservation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/reservations/:id - Update reservation (secretaria only)
router.put('/:id', requireRole('secretaria'), async (req, res) => {
  const { id } = req.params;
  const { responsible_id, area, start_time, end_time, observations } = req.body;

  try {
    // Check if reservation exists
    const existing = await pool.query('SELECT * FROM reservations WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Look up responsible user if provided
    let responsible = null;
    if (responsible_id) {
      const userResult = await pool.query(
        'SELECT id, name, email FROM users WHERE id = $1 AND active = true',
        [responsible_id]
      );
      if (userResult.rows.length === 0) {
        return res.status(400).json({ error: 'Responsible user not found' });
      }
      responsible = userResult.rows[0];
    }

    // Check for overlap (excluding current reservation)
    if (start_time && end_time) {
      const overlapCheck = await pool.query(
        `SELECT id FROM reservations
         WHERE status = 'active' AND id != $1
         AND start_time < $3 AND end_time > $2`,
        [id, start_time, end_time]
      );

      if (overlapCheck.rows.length > 0) {
        return res.status(409).json({ error: 'Time slot is already booked' });
      }
    }

    // Update reservation
    const result = await pool.query(
      `UPDATE reservations
       SET responsible_id   = COALESCE($2, responsible_id),
           responsible_name = COALESCE($3, responsible_name),
           area             = COALESCE($4, area),
           start_time       = COALESCE($5, start_time),
           end_time         = COALESCE($6, end_time),
           observations     = COALESCE($7, observations),
           last_modified_by = $8,
           updated_at       = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, responsible?.id ?? null, responsible?.name ?? null, area, start_time, end_time, observations, req.user.id]
    );

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'update_reservation', 'reservations', id]
    );

    // Compute which fields actually changed and notify the responsible person
    const before = existing.rows[0];
    const after  = result.rows[0];
    const fieldLabels = {
      responsible_name: 'responsable',
      area: 'área',
      start_time: 'inicio',
      end_time: 'fin',
      observations: 'observaciones',
    };
    const changes = Object.keys(fieldLabels).filter(k => {
      const a = before[k] instanceof Date ? before[k].toISOString() : before[k];
      const b = after[k]  instanceof Date ? after[k].toISOString()  : after[k];
      return a !== b;
    }).map(k => fieldLabels[k]);

    if (changes.length && after.responsible_id) {
      const userQ = await pool.query('SELECT email FROM users WHERE id = $1', [after.responsible_id]);
      if (userQ.rows[0]?.email) {
        const { subject, html } = reservationUpdatedEmail(after, changes);
        sendEmail(userQ.rows[0].email, subject, html);
      }
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating reservation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/reservations/:id - Cancel single reservation (soft delete)
router.delete('/:id', requireRole('secretaria'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE reservations SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'cancel_reservation', 'reservations', id]
    );

    // Send cancellation email to responsible person (non-blocking)
    if (result.rows[0].responsible_id) {
      const resp = await pool.query('SELECT email FROM users WHERE id = $1', [result.rows[0].responsible_id]);
      if (resp.rows.length > 0) {
        const { subject, html } = reservationCancelledEmail(result.rows[0]);
        sendEmail(resp.rows[0].email, subject, html);
      }
    }

    res.status(204).send();
  } catch (err) {
    console.error('Error cancelling reservation:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/reservations/bulk - Cancel multiple reservations
router.delete('/bulk', requireRole('secretaria'), async (req, res) => {
  const { ids } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  try {
    const result = await pool.query(
      `UPDATE reservations SET status = 'cancelled', updated_at = NOW()
       WHERE id = ANY($1::uuid[])
       RETURNING *`,
      [ids]
    );

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, details)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'bulk_cancel_reservations', 'reservations', JSON.stringify({ count: result.rows.length })]
    );

    // Send a cancellation email per affected reservation (non-blocking)
    const responsibleIds = [...new Set(result.rows.map(r => r.responsible_id).filter(Boolean))];
    if (responsibleIds.length) {
      const usersQ = await pool.query(
        'SELECT id, email FROM users WHERE id = ANY($1::uuid[])',
        [responsibleIds]
      );
      const emailById = new Map(usersQ.rows.map(u => [u.id, u.email]));
      for (const reservation of result.rows) {
        const email = emailById.get(reservation.responsible_id);
        if (email) {
          const { subject, html } = reservationCancelledEmail(reservation);
          sendEmail(email, subject, html);
        }
      }
    }

    res.json({ deleted: result.rows.length });
  } catch (err) {
    console.error('Error bulk cancelling reservations:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
