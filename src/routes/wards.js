import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireHospital, requireWriteAccess } from '../middleware/auth.js';
import { logDataModification, logError } from '../lib/logger.js';

const router = Router({ mergeParams: true });

// GET /hospitals/:id/wards?departmentId=...
router.get('/', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const { departmentId } = req.query;

        let query = db.collection(`hospitals/${hospitalId}/wards`).orderBy('name');
        if (departmentId) query = query.where('departmentId', '==', departmentId);

        const snap = await query.get();
        return res.json(snap.docs.map((w) => ({ _id: w.id, ...w.data() })));
    } catch (err) {
        logError('WARDS_API', 'Failed to list wards', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /hospitals/:id/wards
router.post('/', requireAuth, requireHospital, requireWriteAccess, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const name = String(req.body.name || '').trim();
        const { departmentId } = req.body;
        if (!name || !departmentId) return res.status(400).json({ error: 'Ward name and department are required' });

        const [hospitalSnap, deptSnap] = await Promise.all([
            db.doc(`hospitals/${hospitalId}`).get(),
            db.doc(`hospitals/${hospitalId}/departments/${departmentId}`).get(),
        ]);
        if (!hospitalSnap.exists) return res.status(404).json({ error: 'Hospital not found' });
        if (!deptSnap.exists) return res.status(404).json({ error: 'Department not found' });

        const now = new Date().toISOString();
        const ref = db.collection(`hospitals/${hospitalId}/wards`).doc();
        const data = {
            hospitalId,
            departmentId,
            name,
            description: String(req.body.description || '').trim(),
            isActive: true,
            createdAt: now,
            updatedAt: now,
        };
        await ref.set(data);

        logDataModification('CREATE', 'ward', ref.id, { hospitalId, departmentId, name });
        return res.status(201).json({ _id: ref.id, ...data });
    } catch (err) {
        logError('WARDS_API', 'Failed to create ward', err);
        return res.status(500).json({ error: err.message });
    }
});

// PATCH /hospitals/:id/wards/:wardId
router.patch('/:wardId', requireAuth, requireHospital, requireWriteAccess, async (req, res) => {
    try {
        const { id: hospitalId, wardId } = req.params;
        const ref = db.doc(`hospitals/${hospitalId}/wards/${wardId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Ward not found' });

        const allowed = ['name', 'description', 'isActive'];
        const update = { updatedAt: new Date().toISOString() };
        for (const key of allowed) {
            if (req.body[key] !== undefined) update[key] = req.body[key];
        }
        if (update.name) update.name = String(update.name).trim();

        await ref.update(update);
        const updated = await ref.get();

        logDataModification('UPDATE', 'ward', wardId, { fields: Object.keys(update) });
        return res.json({ _id: updated.id, ...updated.data() });
    } catch (err) {
        logError('WARDS_API', 'Failed to update ward', err);
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /hospitals/:id/wards/:wardId
router.delete('/:wardId', requireAuth, requireHospital, requireWriteAccess, async (req, res) => {
    try {
        const { id: hospitalId, wardId } = req.params;

        const [staffCount, schedCount] = await Promise.all([
            db.collection(`hospitals/${hospitalId}/staff`).where('wardId', '==', wardId).count().get(),
            db.collection(`hospitals/${hospitalId}/schedules`).where('wardId', '==', wardId).count().get(),
        ]);
        const sc = staffCount.data().count;
        const schedC = schedCount.data().count;
        if (sc > 0 || schedC > 0) {
            return res.status(409).json({ error: `Cannot delete: ${sc} staff and ${schedC} schedule(s) still use this ward.` });
        }

        const ref = db.doc(`hospitals/${hospitalId}/wards/${wardId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Ward not found' });

        await ref.delete();

        logDataModification('DELETE', 'ward', wardId, { name: snap.data().name });
        return res.json({ success: true });
    } catch (err) {
        logError('WARDS_API', 'Failed to delete ward', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
