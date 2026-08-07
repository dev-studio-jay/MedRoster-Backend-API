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

const app = express();

// ── Security & parsing ───────────────────────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '2mb' }));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim());

app.use(cors({
    origin: (origin, cb) => {
        // Allow server-to-server calls (no origin) and whitelisted origins
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} not allowed by CORS`));
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
