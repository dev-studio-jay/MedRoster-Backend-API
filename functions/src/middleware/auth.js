import { adminAuth, db } from '../config/firebase.js';

export async function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized — missing Bearer token' });
    }

    try {
        const decoded = await adminAuth.verifyIdToken(header.slice(7));
        const userSnap = await db.doc(`users/${decoded.uid}`).get();
        if (!userSnap.exists) {
            return res.status(401).json({ error: 'User account not found' });
        }
        const userData = userSnap.data();
        if (!userData.isActive) {
            return res.status(403).json({ error: 'Account is inactive' });
        }
        req.user = { uid: decoded.uid, ...userData };
        next();
    } catch (err) {
        if (err.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Token expired — please sign in again' });
        }
        return res.status(401).json({ error: 'Invalid token' });
    }
}

export function requireHospital(req, res, next) {
    const hospitalId = req.params.hospitalId || req.params.id;
    if (!hospitalId) {
        return res.status(400).json({ error: 'Hospital ID missing from request' });
    }
    if (hospitalId !== req.user.hospitalId) {
        return res.status(403).json({ error: 'Access denied to this hospital' });
    }
    next();
}
