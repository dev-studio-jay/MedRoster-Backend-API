import {onRequest} from 'firebase-functions/v2/https';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Initialize Firebase Admin before importing routes
import './src/config/firebase.js';

import authRoutes from './src/routes/auth.js';
import hospitalRoutes from './src/routes/hospitals.js';
import departmentRoutes from './src/routes/departments.js';
import wardRoutes from './src/routes/wards.js';
import staffRoutes from './src/routes/staff.js';
import scheduleRoutes from './src/routes/schedules.js';
import generateRoutes from './src/routes/generate.js';

const app = express();

// Security & parsing
app.use(helmet());
app.use(express.json({limit: '2mb'}));

// CORS - allow all origins for Cloud Functions (handle in firebase.json rewrites)
app.use(cors({origin: true, credentials: true}));

// Rate limiting
app.use('/api/auth/register', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: {error: 'Too many registration attempts'}
}));
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: {error: 'Too many requests'}
}));

// Health check
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString()
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/hospitals/:id/departments', departmentRoutes);
app.use('/api/hospitals/:id/wards', wardRoutes);
app.use('/api/hospitals/:id/staff', staffRoutes);
app.use('/api/hospitals/:id/schedules', scheduleRoutes);
app.use('/api/hospitals/:id/schedules/:schedId/generate', generateRoutes);

// Error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({error: err.message || 'Internal server error'});
});

// Export as Cloud Function
export const api = onRequest({
  region: 'us-central1',
  maxInstances: 10,
  memory: '256MiB',
  timeoutSeconds: 60
}, app);
