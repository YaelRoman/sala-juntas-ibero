const express = require('express');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// GET /api/calendar/holidays - Get all holidays and closures (public)
router.get('/holidays', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM calendar_events ORDER BY date ASC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching holidays:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/calendar/holidays - Create new holiday (secretaria only)
router.post('/holidays', auth, requireRole('secretaria'), async (req, res) => {
  const { date, name, type } = req.body;

  if (!date || !name || !type) {
    return res.status(400).json({ error: 'date, name, and type required' });
  }

  if (!['holiday', 'closure', 'evento'].includes(type)) {
    return res.status(400).json({ error: 'type must be "holiday", "closure", or "evento"' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO calendar_events (date, name, type)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [date, name, type]
    );

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'create_calendar_event', 'calendar_events', result.rows[0].id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Error creating holiday:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/calendar/holidays/:id - Delete holiday (secretaria only)
router.delete('/holidays/:id', auth, requireRole('secretaria'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM calendar_events WHERE id = $1 RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Holiday not found' });
    }

    // Log to audit
    await pool.query(
      `INSERT INTO audit_log (user_id, action, entity, entity_id)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, 'delete_calendar_event', 'calendar_events', id]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Error deleting holiday:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
