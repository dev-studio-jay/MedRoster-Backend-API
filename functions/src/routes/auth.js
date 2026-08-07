import { Router } from 'express';
import { adminAuth, db } from '../config/firebase.js';
import { logDataModification, logError } from '../lib/logger.js';

const router = Router();

// POST /auth/register — create a Firebase Auth user + Firestore hospital + user doc.
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, hospitalName, hospitalType, hospitalRegion, hospitalLocation } = req.body;

        if (!name || !email || !password || !hospitalName) {
            return res.status(400).json({ error: 'Name, email, password, and hospital name are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        // Check if email is already in Firebase Auth
        try {
            await adminAuth.getUserByEmail(email.toLowerCase().trim());
            return res.status(409).json({ error: 'An account with this email already exists' });
        } catch (err) {
            if (err.code !== 'auth/user-not-found') throw err;
        }

        // Create Firebase Auth user
        const authUser = await adminAuth.createUser({
            email: email.toLowerCase().trim(),
            password,
            displayName: name.trim(),
        });

        // Create hospital doc
        const hospitalRef = db.collection('hospitals').doc();
        const now = new Date().toISOString();
        await hospitalRef.set({
            name: hospitalName.trim(),
            type: hospitalType || 'District Hospital',
            region: hospitalRegion || 'Greater Accra',
            location: hospitalLocation?.trim() || '',
            ghsCode: '',
            shiftTypes: [
                { id: 'morning', name: 'Morning', color: 'morning', startTime: '08:00', endTime: '14:00' },
                { id: 'afternoon', name: 'Afternoon', color: 'afternoon', startTime: '14:00', endTime: '20:00' },
                { id: 'night', name: 'Night', color: 'night', startTime: '20:00', endTime: '08:00' },
                { id: 'sod', name: 'SOD', color: 'sod', startTime: '08:00', endTime: '20:00' },
            ],
            settings: {
                maxConsecutiveDays: 6,
                maxConsecutiveNights: 3,
                minSeniorStaffPerDay: 1,
                maxHoursPerWeek: 48,
                validationRules: {
                    enforceLeaveConflicts: true,
                    enforceRoleShiftRestrictions: true,
                    enforceSupervisoryCoverage: true,
                    warnConsecutiveShifts: true,
                },
            },
            createdAt: now,
            updatedAt: now,
        });

        // Create user doc keyed by Firebase Auth UID
        await db.doc(`users/${authUser.uid}`).set({
            email: authUser.email,
            name: name.trim(),
            hospitalId: hospitalRef.id,
            role: 'admin',
            isActive: true,
            createdAt: now,
            updatedAt: now,
        });

        logDataModification('CREATE', 'user+hospital', authUser.uid, {
            email: authUser.email,
            hospitalId: hospitalRef.id,
            hospitalName: hospitalName.trim(),
        });

        return res.status(201).json({ message: 'Account created', hospitalId: hospitalRef.id });
    } catch (err) {
        logError('AUTH_REGISTER', 'Registration failed', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
