import { Router } from 'express';
import { db, docToJson } from '../config/firebase.js';
import { requireAuth, requireHospital } from '../middleware/auth.js';
import { logDataModification, logError } from '../lib/logger.js';

const router = Router();

// GET /hospitals — returns authenticated user's hospital with summary counts.
router.get('/', requireAuth, async (req, res) => {
    try {
        const { hospitalId } = req.user;
        const snap = await db.doc(`hospitals/${hospitalId}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'Hospital not found' });

        const [depCount, wardCount, staffCount, schedCount] = await Promise.all([
            db.collection(`hospitals/${hospitalId}/departments`).count().get(),
            db.collection(`hospitals/${hospitalId}/wards`).count().get(),
            db.collection(`hospitals/${hospitalId}/staff`).count().get(),
            db.collection(`hospitals/${hospitalId}/schedules`).count().get(),
        ]);

        return res.json([{
            ...docToJson(snap),
            counts: {
                departments: depCount.data().count,
                wards: wardCount.data().count,
                staff: staffCount.data().count,
                schedules: schedCount.data().count,
            },
        }]);
    } catch (err) {
        logError('HOSPITALS_API', 'Failed to list hospitals', err);
        return res.status(500).json({ error: err.message });
    }
});

// GET /hospitals/:id — full hospital with departments, wards, and counts.
router.get('/:id', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const snap = await db.doc(`hospitals/${hospitalId}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'Hospital not found' });

        const [deptSnap, wardSnap, staffCount, schedCount] = await Promise.all([
            db.collection(`hospitals/${hospitalId}/departments`).orderBy('name').get(),
            db.collection(`hospitals/${hospitalId}/wards`).orderBy('name').get(),
            db.collection(`hospitals/${hospitalId}/staff`).count().get(),
            db.collection(`hospitals/${hospitalId}/schedules`).count().get(),
        ]);

        const departments = deptSnap.docs.map((d) => ({ _id: d.id, ...d.data() }));
        const wards = wardSnap.docs.map((w) => ({ _id: w.id, ...w.data() }));

        return res.json({
            ...docToJson(snap),
            departments,
            wards,
            counts: {
                departments: departments.length,
                wards: wards.length,
                staff: staffCount.data().count,
                schedules: schedCount.data().count,
            },
        });
    } catch (err) {
        logError('HOSPITALS_API', 'Failed to fetch hospital', err);
        return res.status(500).json({ error: err.message });
    }
});

// PATCH /hospitals/:id — update hospital fields or settings.
router.patch('/:id', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const allowed = ['name', 'type', 'region', 'location', 'ghsCode', 'shiftTypes', 'settings'];
        const update = { updatedAt: new Date().toISOString() };
        for (const key of allowed) {
            if (req.body[key] !== undefined) update[key] = req.body[key];
        }

        const ref = db.doc(`hospitals/${hospitalId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Hospital not found' });

        await ref.update(update);
        const updated = await ref.get();

        logDataModification('UPDATE', 'hospital', hospitalId, { fields: Object.keys(update) });
        return res.json(docToJson(updated));
    } catch (err) {
        logError('HOSPITALS_API', 'Failed to update hospital', err);
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /hospitals/:id — delete hospital and all subcollections.
router.delete('/:id', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const hospitalRef = db.doc(`hospitals/${hospitalId}`);
        const snap = await hospitalRef.get();
        if (!snap.exists) return res.status(404).json({ error: 'Hospital not found' });

        // Delete subcollections in order (assignments first as they're deepest)
        const schedSnap = await db.collection(`hospitals/${hospitalId}/schedules`).get();
        for (const schedDoc of schedSnap.docs) {
            const assignSnap = await schedDoc.ref.collection('assignments').get();
            const batch = db.batch();
            assignSnap.docs.forEach((d) => batch.delete(d.ref));
            batch.delete(schedDoc.ref);
            await batch.commit();
        }

        const [deptSnap, wardSnap, staffSnap] = await Promise.all([
            db.collection(`hospitals/${hospitalId}/departments`).get(),
            db.collection(`hospitals/${hospitalId}/wards`).get(),
            db.collection(`hospitals/${hospitalId}/staff`).get(),
        ]);

        const batch = db.batch();
        [...deptSnap.docs, ...wardSnap.docs, ...staffSnap.docs].forEach((d) => batch.delete(d.ref));
        batch.delete(hospitalRef);
        await batch.commit();

        logDataModification('DELETE', 'hospital', hospitalId, { name: snap.data().name });
        return res.json({ success: true });
    } catch (err) {
        logError('HOSPITALS_API', 'Failed to delete hospital', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
