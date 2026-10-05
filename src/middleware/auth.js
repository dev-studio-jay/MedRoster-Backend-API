import { adminAuth, db } from '../config/firebase.js';
import { ACCOUNT_TYPES, getTierLimits } from '../lib/tier-limits.js';
import { logError } from '../lib/logger.js';

function bearerToken(header) {
    return header.slice(7).trim();
}

/** Verify Firebase ID token only (user doc may not exist yet). */
export async function requireFirebaseUser(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized — missing Bearer token' });
    }

    try {
        req.firebaseUser = await adminAuth.verifyIdToken(bearerToken(header));
        next();
    } catch (err) {
        logError('AUTH', 'verifyIdToken failed', err);
        if (err.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expired — please sign in again' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
}

export async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized — missing Bearer token' });
    }

    let decoded;
    try {
        decoded = await adminAuth.verifyIdToken(bearerToken(header));
    } catch (err) {
        logError('AUTH', 'verifyIdToken failed', err);
        if (err.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expired — please sign in again' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }

    try {
        const userSnap = await db.doc(`users/${decoded.uid}`).get();
        if (!userSnap.exists) {
            return res.status(401).json({ error: 'User account not found' });
        }
        const userData = userSnap.data();
        if (userData.isActive === false) {
            return res.status(403).json({ error: 'Account is inactive' });
        }
        const accountType = userData.accountType
            || (userData.hospitalId ? ACCOUNT_TYPES.ENTERPRISE : ACCOUNT_TYPES.INDIVIDUAL);
        req.user = {
            uid: decoded.uid,
            ...userData,
            accountType,
            role: userData.role || 'admin',
        };
        req.tierLimits = getTierLimits(accountType);
        next();
    } catch (err) {
        logError('AUTH', 'Failed to load user profile', err);
        return res.status(500).json({ error: 'Could not load your account. Please try again.' });
    }
}

export function requireHospital(req, res, next) {
    const hospitalId = req.params.hospitalId || req.params.id;
    if (!hospitalId) {
        return res.status(400).json({ error: 'Hospital ID missing from request' });
    }
    if (!req.user.hospitalId || hospitalId !== req.user.hospitalId) {
        return res.status(403).json({ error: 'Access denied to this hospital' });
    }
    next();
}

/** Admin-only actions within a hospital. */
export function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

/** Block staff from mutating; allow read. Use on mutating routes. */
export function requireWriteAccess(req, res, next) {
    if (req.user.role === 'staff') {
        return res.status(403).json({ error: 'Staff accounts are read-only' });
    }
    next();
}
