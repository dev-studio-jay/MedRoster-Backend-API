import { Router } from 'express';
import { adminAuth, db, batchedSet } from '../config/firebase.js';
import { requireAuth, requireFirebaseUser } from '../middleware/auth.js';
import { allocateUniqueJoinCode, defaultHospitalDoc, findHospitalByJoinCode } from '../lib/hospital-utils.js';
import { ACCOUNT_TYPES } from '../lib/tier-limits.js';
import { isValidJoinCodeFormat, normalizeJoinCode } from '../lib/hospital-code.js';
import { logDataModification, logError } from '../lib/logger.js';

const router = Router();

async function createEnterpriseHospitalAndUser({
    uid, email, name, hospitalName, hospitalType, hospitalRegion, hospitalLocation, provider,
}) {
    const { joinCode, joinCodeKey } = await allocateUniqueJoinCode();
    const hospitalRef = db.collection('hospitals').doc();
    const now = new Date().toISOString();
    await hospitalRef.set(defaultHospitalDoc({
        hospitalName, hospitalType, hospitalRegion, hospitalLocation, now, joinCode,
    }));
    // ensure joinCodeKey matches allocated
    await hospitalRef.update({ joinCode, joinCodeKey });

    await db.doc(`users/${uid}`).set({
        email: email || '',
        name: name.trim(),
        phone: '',
        accountType: ACCOUNT_TYPES.ENTERPRISE,
        hospitalId: hospitalRef.id,
        role: 'admin',
        isActive: true,
        ...(provider ? { provider } : {}),
        createdAt: now,
        updatedAt: now,
    });

    return { hospitalId: hospitalRef.id, joinCode: normalizeJoinCode(joinCode) };
}

async function createIndividualUser({ uid, email, name, phone, provider }) {
    const now = new Date().toISOString();
    await db.doc(`users/${uid}`).set({
        email: email || '',
        name: name.trim(),
        phone: phone || '',
        accountType: ACCOUNT_TYPES.INDIVIDUAL,
        hospitalId: null,
        role: 'admin',
        isActive: true,
        ...(provider ? { provider } : {}),
        createdAt: now,
        updatedAt: now,
    });
    return { accountType: ACCOUNT_TYPES.INDIVIDUAL };
}

// POST /auth/register — email/password. Body.accountType: 'individual' | 'enterprise' (default enterprise for backward compat when hospitalName present)
router.post('/register', async (req, res) => {
    try {
        const {
            name, email, password, phone,
            hospitalName, hospitalType, hospitalRegion, hospitalLocation,
            accountType: rawType,
        } = req.body;

        const accountType = rawType === ACCOUNT_TYPES.INDIVIDUAL
            ? ACCOUNT_TYPES.INDIVIDUAL
            : (hospitalName ? ACCOUNT_TYPES.ENTERPRISE : ACCOUNT_TYPES.INDIVIDUAL);

        if (!name || !email || !password) {
            return res.status(400).json({ error: 'Name, email, and password are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (accountType === ACCOUNT_TYPES.ENTERPRISE && !hospitalName) {
            return res.status(400).json({ error: 'Hospital name is required for enterprise accounts' });
        }

        try {
            await adminAuth.getUserByEmail(email.toLowerCase().trim());
            return res.status(409).json({ error: 'An account with this email already exists' });
        } catch (err) {
            if (err.code !== 'auth/user-not-found') throw err;
        }

        const authUser = await adminAuth.createUser({
            email: email.toLowerCase().trim(),
            password,
            displayName: name.trim(),
            ...(phone ? { phoneNumber: phone } : {}),
        });

        if (accountType === ACCOUNT_TYPES.INDIVIDUAL) {
            await createIndividualUser({
                uid: authUser.uid,
                email: authUser.email,
                name,
                phone: phone || '',
            });
            logDataModification('CREATE', 'user-individual', authUser.uid, { email: authUser.email });
            return res.status(201).json({
                message: 'Individual account created',
                accountType: ACCOUNT_TYPES.INDIVIDUAL,
            });
        }

        const result = await createEnterpriseHospitalAndUser({
            uid: authUser.uid,
            email: authUser.email,
            name,
            hospitalName,
            hospitalType,
            hospitalRegion,
            hospitalLocation,
        });

        logDataModification('CREATE', 'user+hospital', authUser.uid, {
            email: authUser.email,
            hospitalId: result.hospitalId,
            hospitalName: hospitalName.trim(),
            joinCode: result.joinCode,
        });

        return res.status(201).json({
            message: 'Account created',
            accountType: ACCOUNT_TYPES.ENTERPRISE,
            hospitalId: result.hospitalId,
            joinCode: result.joinCode,
        });
    } catch (err) {
        logError('AUTH_REGISTER', 'Registration failed', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /auth/register-google — enterprise (hospital) or individual via accountType
router.post('/register-google', requireFirebaseUser, async (req, res) => {
    try {
        const {
            hospitalName, hospitalType, hospitalRegion, hospitalLocation, name,
            accountType: rawType,
        } = req.body;

        const uid = req.firebaseUser.uid;
        const existing = await db.doc(`users/${uid}`).get();
        if (existing.exists) {
            const data = existing.data();
            return res.status(409).json({
                error: 'This Google account is already registered',
                hospitalId: data.hospitalId || null,
                accountType: data.accountType || ACCOUNT_TYPES.ENTERPRISE,
            });
        }

        const authUser = await adminAuth.getUser(uid);
        const displayName = (name?.trim() || authUser.displayName || authUser.email || 'Admin').trim();
        const accountType = rawType === ACCOUNT_TYPES.INDIVIDUAL
            ? ACCOUNT_TYPES.INDIVIDUAL
            : (hospitalName ? ACCOUNT_TYPES.ENTERPRISE : ACCOUNT_TYPES.INDIVIDUAL);

        if (accountType === ACCOUNT_TYPES.INDIVIDUAL) {
            await createIndividualUser({
                uid,
                email: authUser.email || req.firebaseUser.email || '',
                name: displayName,
                provider: 'google',
            });
            return res.status(201).json({
                message: 'Individual account created',
                accountType: ACCOUNT_TYPES.INDIVIDUAL,
            });
        }

        if (!hospitalName) {
            return res.status(400).json({ error: 'Hospital name is required for enterprise accounts' });
        }

        const result = await createEnterpriseHospitalAndUser({
            uid,
            email: authUser.email || req.firebaseUser.email || '',
            name: displayName,
            hospitalName,
            hospitalType,
            hospitalRegion,
            hospitalLocation,
            provider: 'google',
        });

        logDataModification('CREATE', 'user+hospital', uid, {
            email: authUser.email,
            hospitalId: result.hospitalId,
            hospitalName: hospitalName.trim(),
            provider: 'google',
            joinCode: result.joinCode,
        });

        return res.status(201).json({
            message: 'Account created',
            accountType: ACCOUNT_TYPES.ENTERPRISE,
            hospitalId: result.hospitalId,
            joinCode: result.joinCode,
        });
    } catch (err) {
        logError('AUTH_REGISTER_GOOGLE', 'Google registration failed', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /auth/register-phone — complete profile after Firebase phone sign-in
router.post('/register-phone', requireFirebaseUser, async (req, res) => {
    try {
        const {
            name, hospitalName, hospitalType, hospitalRegion, hospitalLocation,
            accountType: rawType,
        } = req.body;

        const uid = req.firebaseUser.uid;
        const existing = await db.doc(`users/${uid}`).get();
        if (existing.exists) {
            const data = existing.data();
            return res.status(409).json({
                error: 'This phone account is already registered',
                hospitalId: data.hospitalId || null,
                accountType: data.accountType,
            });
        }

        if (!name?.trim()) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const authUser = await adminAuth.getUser(uid);
        const phone = authUser.phoneNumber || req.firebaseUser.phone_number || '';
        const accountType = rawType === ACCOUNT_TYPES.ENTERPRISE && hospitalName
            ? ACCOUNT_TYPES.ENTERPRISE
            : ACCOUNT_TYPES.INDIVIDUAL;

        if (accountType === ACCOUNT_TYPES.INDIVIDUAL) {
            await createIndividualUser({
                uid,
                email: authUser.email || '',
                name,
                phone,
                provider: 'phone',
            });
            return res.status(201).json({
                message: 'Individual account created',
                accountType: ACCOUNT_TYPES.INDIVIDUAL,
            });
        }

        const result = await createEnterpriseHospitalAndUser({
            uid,
            email: authUser.email || '',
            name,
            hospitalName,
            hospitalType,
            hospitalRegion,
            hospitalLocation,
            provider: 'phone',
        });
        await db.doc(`users/${uid}`).update({ phone });

        return res.status(201).json({
            message: 'Account created',
            accountType: ACCOUNT_TYPES.ENTERPRISE,
            hospitalId: result.hospitalId,
            joinCode: result.joinCode,
        });
    } catch (err) {
        logError('AUTH_REGISTER_PHONE', 'Phone registration failed', err);
        return res.status(500).json({ error: err.message });
    }
});

// GET /auth/me — current user profile
router.get('/me', requireAuth, async (req, res) => {
    try {
        const profile = {
            uid: req.user.uid,
            email: req.user.email || '',
            name: req.user.name || '',
            phone: req.user.phone || '',
            accountType: req.user.accountType || (req.user.hospitalId ? ACCOUNT_TYPES.ENTERPRISE : ACCOUNT_TYPES.INDIVIDUAL),
            hospitalId: req.user.hospitalId || null,
            role: req.user.role || 'admin',
            isActive: req.user.isActive !== false,
        };

        if (profile.hospitalId) {
            const h = await db.doc(`hospitals/${profile.hospitalId}`).get();
            if (h.exists) {
                profile.hospitalName = h.data().name;
                profile.joinCode = h.data().joinCode || null;
            }
        }

        return res.json(profile);
    } catch (err) {
        logError('AUTH_ME', 'Failed to load profile', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /auth/join-hospital — staff joins via join code
router.post('/join-hospital', requireFirebaseUser, async (req, res) => {
    try {
        const { joinCode, name } = req.body;
        if (!joinCode || !isValidJoinCodeFormat(joinCode)) {
            return res.status(400).json({ error: 'A valid hospital join code is required (e.g. KBU-X7F)' });
        }

        const hospital = await findHospitalByJoinCode(joinCode);
        if (!hospital) {
            return res.status(404).json({ error: 'No hospital found for that join code' });
        }

        const uid = req.firebaseUser.uid;
        const existing = await db.doc(`users/${uid}`).get();
        if (existing.exists) {
            const data = existing.data();
            if (data.hospitalId === hospital.id) {
                return res.json({
                    message: 'Already a member of this hospital',
                    hospitalId: hospital.id,
                    hospitalName: hospital.name,
                    role: data.role || 'staff',
                });
            }
            const accountType = data.accountType
                || (data.hospitalId ? ACCOUNT_TYPES.ENTERPRISE : ACCOUNT_TYPES.INDIVIDUAL);
            if (accountType === ACCOUNT_TYPES.INDIVIDUAL && !data.hospitalId) {
                return res.status(409).json({
                    error: 'Individual accounts cannot join a hospital. Upgrade to enterprise first.',
                });
            }
            if (data.hospitalId) {
                return res.status(409).json({
                    error: 'You already belong to another hospital.',
                });
            }
        }

        const authUser = await adminAuth.getUser(uid);
        const now = new Date().toISOString();
        const displayName = (name?.trim() || authUser.displayName || authUser.email || authUser.phoneNumber || 'Staff').trim();

        await db.doc(`users/${uid}`).set({
            email: authUser.email || '',
            phone: authUser.phoneNumber || '',
            name: displayName,
            accountType: ACCOUNT_TYPES.ENTERPRISE,
            hospitalId: hospital.id,
            role: 'staff',
            isActive: true,
            createdAt: existing.exists ? existing.data().createdAt : now,
            updatedAt: now,
        }, { merge: true });

        logDataModification('JOIN', 'hospital', uid, { hospitalId: hospital.id, joinCode: hospital.joinCode });

        return res.status(200).json({
            message: 'Joined hospital',
            hospitalId: hospital.id,
            hospitalName: hospital.name,
            role: 'staff',
            joinCode: hospital.joinCode,
        });
    } catch (err) {
        logError('AUTH_JOIN', 'Join hospital failed', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /auth/upgrade-to-enterprise — individual → enterprise (create hospital, migrate schedules)
router.post('/upgrade-to-enterprise', requireAuth, async (req, res) => {
    try {
        const { hospitalName, hospitalType, hospitalRegion, hospitalLocation } = req.body;
        if (!hospitalName?.trim()) {
            return res.status(400).json({ error: 'Hospital name is required' });
        }

        const uid = req.user.uid;
        if (req.user.accountType === ACCOUNT_TYPES.ENTERPRISE && req.user.hospitalId) {
            return res.status(409).json({
                error: 'Already an enterprise account',
                hospitalId: req.user.hospitalId,
            });
        }

        const { joinCode, joinCodeKey } = await allocateUniqueJoinCode();
        const hospitalRef = db.collection('hospitals').doc();
        const now = new Date().toISOString();
        await hospitalRef.set(defaultHospitalDoc({
            hospitalName, hospitalType, hospitalRegion, hospitalLocation, now, joinCode,
        }));
        await hospitalRef.update({ joinCode, joinCodeKey });

        const schedSnap = await db.collection(`users/${uid}/schedules`).get();
        const seenStaff = new Set();
        const uniqueStaff = [];
        for (const doc of schedSnap.docs) {
            const data = doc.data();
            if (!Array.isArray(data.staff)) continue;
            for (const s of data.staff) {
                const name = `${s.firstName || ''} ${s.lastName || ''}`.trim().toLowerCase();
                const key = `name:${name}`;
                if (!name) continue;
                if (seenStaff.has(key)) continue;
                seenStaff.add(key);
                const {
                    _id: _staffId,
                    id: _legacyId,
                    employeeId: _e,
                    ghanaCardNumber: _g,
                    dateOfBirth: _d,
                    address: _a,
                    licenseType: _lt,
                    licenseNumber: _ln,
                    licenseExpiry: _le,
                    emergencyContact: _ec,
                    ...rest
                } = s;
                uniqueStaff.push({
                    ...rest,
                    hospitalId: hospitalRef.id,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        }
        if (uniqueStaff.length) {
            await batchedSet(db.collection(`hospitals/${hospitalRef.id}/staff`), uniqueStaff);
        }

        await db.doc(`users/${uid}`).update({
            accountType: ACCOUNT_TYPES.ENTERPRISE,
            hospitalId: hospitalRef.id,
            role: 'admin',
            updatedAt: now,
        });

        logDataModification('UPGRADE', 'enterprise', uid, { hospitalId: hospitalRef.id, joinCode, staffMigrated: uniqueStaff.length });

        return res.json({
            message: 'Upgraded to enterprise',
            hospitalId: hospitalRef.id,
            joinCode: normalizeJoinCode(joinCode),
            staffMigrated: uniqueStaff.length,
            schedulesMigrated: 0,
            personalSchedulesRetained: schedSnap.size,
            note: 'Personal schedules were not copied as ward rosters. Add departments and wards, then create hospital schedules.',
        });
    } catch (err) {
        logError('AUTH_UPGRADE', 'Upgrade failed', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
