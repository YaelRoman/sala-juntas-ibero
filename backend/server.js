require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const authRoutes = require('./routes/auth');
const reservationsRoutes = require('./routes/reservations');
const calendarRoutes = require('./routes/calendar');
const usersRoutes = require('./routes/users');
const statsRoutes = require('./routes/stats');
const aiRoutes = require('./routes/ai');
const { runMigrations } = require('./db/migrate');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the first proxy (nginx/Render) so req.ip reflects the real client
// and rate limiters key on the right address. Adjust if topology changes.
app.set('trust proxy', 1);

// Disable ETag so browsers never get 304 Not Modified for API calls
app.set('etag', false);

// Security headers (CSP intentionally disabled — frontend uses inline
// handlers/styles; tighten later in a dedicated CSP pass).
app.use(helmet({ contentSecurityPolicy: false }));

// CORS — restrict to APP_URL when configured. Falling back to wildcard
// only when APP_URL is unset keeps local dev workable; log so misconfig
// is obvious in production startup.
const corsOrigin = process.env.APP_URL || true;
console.log(`[CORS] origin: ${corsOrigin === true ? '*  (APP_URL not set)' : corsOrigin}`);
app.use(cors({ origin: corsOrigin, credentials: true }));

// Body parser with hard size cap to limit DoS surface
app.use(express.json({ limit: '100kb' }));

// Disable caching for all API responses so clients always get fresh data
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/reservations', reservationsRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/ai', aiRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  // express.json() throws "PayloadTooLargeError" with status 413 — surface it cleanly
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload too large' });
  }
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

runMigrations()
  .catch(err => console.error('[Startup] Migration error:', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Backend server running on port ${PORT}`);
    });
  });
