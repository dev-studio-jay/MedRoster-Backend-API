import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Initialise Firebase Admin before importing routes that use it
import './config/firebase.js';

import authRoutes from './routes/auth.js';
import hospitalRoutes from './routes/hospitals.js';
import departmentRoutes from './routes/departments.js';
import wardRoutes from './routes/wards.js';
import staffRoutes from './routes/staff.js';
import scheduleRoutes from './routes/schedules.js';
import generateRoutes from './routes/generate.js';
import individualRoutes from './routes/individual.js';
import guestRoutes from './routes/guest.js';

const app = express();

// ── Security & parsing ───────────────────────────────────────────────────────
app.use(helmet({
    // API is called from the Next.js origin; default same-origin CORP/COOP breaks that.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
app.use(express.json({ limit: '8mb' }));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

function isLocalDevOrigin(origin) {
    try {
        const u = new URL(origin);
        const localHost =
            u.hostname === 'localhost' ||
            u.hostname === '127.0.0.1' ||
            /^192\.168\.\d+\.\d+$/.test(u.hostname) ||
            /^10\.\d+\.\d+\.\d+$/.test(u.hostname);
        return localHost && (u.port === '3000' || u.port === '');
    } catch {
        return false;
    }
}

app.use(cors({
    origin: (origin, cb) => {
        // No Origin = server-to-server / same-origin tools
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        // Allow LAN frontend during local development (e.g. http://192.168.x.x:3000)
        if (process.env.NODE_ENV !== 'production' && isLocalDevOrigin(origin)) {
            return cb(null, true);
        }
        // Must not throw — throwing omits CORS headers and breaks browser preflight
        return cb(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use('/api/auth/register', rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many registration attempts' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 300, message: { error: 'Too many requests' } }));

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/me', individualRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/hospitals/:id/departments', departmentRoutes);
app.use('/api/hospitals/:id/wards', wardRoutes);
app.use('/api/hospitals/:id/staff', staffRoutes);
app.use('/api/hospitals/:id/schedules', scheduleRoutes);
app.use('/api/hospitals/:id/schedules/:schedId/generate', generateRoutes);

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Internal server error' });
});

// Export for Vercel serverless
export default app;

// Local development server
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 4000;
    app.listen(PORT, () => {
        console.log(`MedRoster API running on http://localhost:${PORT}`);
    });
}
