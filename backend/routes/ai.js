const express = require('express');
const auth    = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const pool    = require('../db/pool');

const router = express.Router();

router.use(auth);

router.get('/status', (req, res) => {
  res.json({ enabled: Boolean(process.env.AI_API_KEY) });
});

router.post('/parse', requireRole('secretaria'), async (req, res) => {
  const { text, today, date } = req.body || {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI not configured' });
  }

  const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
  const model    = process.env.AI_MODEL
    || (provider === 'openai' ? 'gpt-4o-mini' : 'claude-haiku-4-5-20251001');

  const todayStr = /^\d{4}-\d{2}-\d{2}$/.test(today || '')
    ? today
    : new Date().toISOString().slice(0, 10);

  // ── Fetch context from DB ──────────────────────────────────────
  const [usersResult, reservationsResult] = await Promise.all([
    pool.query(
      `SELECT id, name, role FROM users WHERE active = true ORDER BY name ASC`
    ),
    // If caller already knows the target date, load that day's reservations
    /^\d{4}-\d{2}-\d{2}$/.test(date || '')
      ? pool.query(
          `SELECT responsible_name, area,
                  to_char(start_time AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS start_time,
                  to_char(end_time   AT TIME ZONE 'America/Mexico_City', 'HH24:MI') AS end_time
           FROM reservations
           WHERE status = 'active'
             AND start_time >= $1::date
             AND start_time <  $1::date + INTERVAL '1 day'
           ORDER BY start_time ASC`,
          [date]
        )
      : Promise.resolve({ rows: [] }),
  ]);

  // ── Build context sections ─────────────────────────────────────
  const usersBlock = usersResult.rows.length
    ? '# Responsables registrados en el sistema (usa el id exacto en responsible_id):\n' +
      usersResult.rows.map(u => `- id:${u.id} | ${u.name} (${u.role})`).join('\n')
    : '';

  const reservationsBlock = reservationsResult.rows.length
    ? `# Reservaciones ya existentes el ${date}:\n` +
      reservationsResult.rows.map(r =>
        `- ${r.start_time}–${r.end_time}: ${r.responsible_name} / ${r.area}`
      ).join('\n') +
      '\nSi el horario solicitado traslapa con alguna de estas reservaciones, ' +
      'indícalo en el campo "conflict" (true/false) y sugiere un horario alternativo libre en "suggestedStartTime"/"suggestedEndTime".'
    : '';

  const systemPrompt = `Eres un asistente que extrae datos de reservaciones de sala de juntas para la Universidad Iberoamericana Ciudad de México.
Dado un texto en español, extrae los siguientes campos y devuelve SOLO un objeto JSON válido, sin markdown ni texto adicional:
{
  "date": "YYYY-MM-DD o null",
  "startTime": "HH:MM o null",
  "endTime": "HH:MM o null",
  "responsible": "nombre completo tal como aparece en el texto, o cadena vacía",
  "responsible_id": "el id exacto del responsable de la lista de usuarios si hay coincidencia clara, o null",
  "area": "Nombre completo y formal del área o departamento (expándelo si está abreviado; si no se menciona, usa cadena vacía)",
  "observations": "Notas ampliadas y redactadas formalmente con toda la información relevante (propósito, participantes, requerimientos especiales, etc.); si no hay información adicional usa cadena vacía",
  "conflict": false,
  "suggestedStartTime": null,
  "suggestedEndTime": null
}
La fecha de hoy es ${todayStr}.
Si se menciona "mañana", calcula la fecha correcta.
Si se menciona un día de la semana sin fecha, usa el próximo que ocurra desde hoy.
Las horas usan formato 24h. Si se dice "3 de la tarde" usa 15:00.
Si solo se menciona duración (ej. "2 horas"), calcula endTime = startTime + duración.
Para responsible_id: compara el nombre mencionado con la lista y devuelve el id solo si la coincidencia es clara (mismo apellido y nombre aproximado). Si hay duda, devuelve null.
${usersBlock}
${reservationsBlock}`.trim();

  try {
    let url, headers, body;

    if (provider === 'openai') {
      url     = 'https://api.openai.com/v1/chat/completions';
      headers = {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${apiKey}`,
      };
      body = JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: text },
        ],
        temperature:          0,
        max_completion_tokens: 512,
      });
    } else {
      url     = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model,
        max_tokens: 512,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: text }],
      });
    }

    const response = await fetch(url, { method: 'POST', headers, body });

    if (!response.ok) {
      const errBody = await response.text();
      console.error(`[AI] ${provider} HTTP ${response.status}:`, errBody.slice(0, 300));
      return res.status(502).json({ error: 'AI provider error' });
    }

    const data = await response.json();
    const raw  = provider === 'openai'
      ? (data.choices?.[0]?.message?.content ?? '')
      : (data.content?.[0]?.text ?? '');

    const clean = String(raw).replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch {
      return res.status(502).json({ error: 'AI returned invalid JSON' });
    }

    // Validate that responsible_id actually exists in the users we fetched
    const validIds  = new Set(usersResult.rows.map(u => u.id));
    const respId    = validIds.has(parsed.responsible_id) ? parsed.responsible_id : null;

    res.json({
      date:               parsed.date               ?? null,
      startTime:          parsed.startTime          ?? null,
      endTime:            parsed.endTime            ?? null,
      responsible:        String(parsed.responsible ?? '').trim(),
      responsible_id:     respId,
      area:               String(parsed.area         ?? '').trim(),
      observations:       String(parsed.observations ?? '').trim(),
      conflict:           Boolean(parsed.conflict),
      suggestedStartTime: parsed.suggestedStartTime ?? null,
      suggestedEndTime:   parsed.suggestedEndTime   ?? null,
    });
  } catch (err) {
    console.error('[AI] parse error:', err);
    res.status(500).json({ error: 'AI request failed' });
  }
});

module.exports = router;
