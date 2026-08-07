import { Router } from 'express';
import { db } from '../config/firebase.js';
import { requireAuth, requireHospital } from '../middleware/auth.js';
import { logDataModification, logError } from '../lib/logger.js';

const router = Router({ mergeParams: true });

// GET /hospitals/:id/departments
router.get('/', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const snap = await db.collection(`hospitals/${hospitalId}/departments`).orderBy('name').get();
        return res.json(snap.docs.map((d) => ({ _id: d.id, ...d.data() })));
    } catch (err) {
        logError('DEPARTMENTS_API', 'Failed to list departments', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /hospitals/:id/departments
router.post('/', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const hospitalSnap = await db.doc(`hospitals/${hospitalId}`).get();
        if (!hospitalSnap.exists) return res.status(404).json({ error: 'Hospital not found' });

        const now = new Date().toISOString();
        const coll = db.collection(`hospitals/${hospitalId}/departments`);

        // Bulk create
        if (Array.isArray(req.body.departments)) {
            const seen = new Set();
            const valid = req.body.departments
                .map((d) => ({ name: String(d.name || '').trim(), description: String(d.description || '').trim() }))
                .filter((d) => {
                    if (!d.name) return false;
                    const key = d.name.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            if (!valid.length) return res.status(400).json({ error: 'No valid department names provided' });

            const created = [];
            const batch = db.batch();
            for (const d of valid) {
                const ref = coll.doc();
                const data = { hospitalId, name: d.name, description: d.description, isActive: true, createdAt: now, updatedAt: now };
                batch.set(ref, data);
                created.push({ _id: ref.id, ...data });
            }
            await batch.commit();

            logDataModification('CREATE', 'departments', hospitalId, { count: created.length });
            return res.status(201).json(created);
        }

        // Single create
        const name = String(req.body.name || '').trim();
        if (!name) return res.status(400).json({ error: 'Department name is required' });

        const ref = coll.doc();
        const data = { hospitalId, name, description: String(req.body.description || '').trim(), isActive: true, createdAt: now, updatedAt: now };
        await ref.set(data);

        logDataModification('CREATE', 'department', ref.id, { name, hospitalId });
        return res.status(201).json({ _id: ref.id, ...data });
    } catch (err) {
        logError('DEPARTMENTS_API', 'Failed to create department', err);
        return res.status(500).json({ error: err.message });
    }
});

// PATCH /hospitals/:id/departments/:depId
router.patch('/:depId', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, depId } = req.params;
        const ref = db.doc(`hospitals/${hospitalId}/departments/${depId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Department not found' });

        const allowed = ['name', 'description', 'isActive'];
        const update = { updatedAt: new Date().toISOString() };
        for (const key of allowed) {
            if (req.body[key] !== undefined) update[key] = req.body[key];
        }
        if (update.name) update.name = String(update.name).trim();

        await ref.update(update);
        const updated = await ref.get();

        logDataModification('UPDATE', 'department', depId, { fields: Object.keys(update) });
        return res.json({ _id: updated.id, ...updated.data() });
    } catch (err) {
        logError('DEPARTMENTS_API', 'Failed to update department', err);
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /hospitals/:id/departments/:depId
router.delete('/:depId', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, depId } = req.params;

        const [staffCount, wardCount] = await Promise.all([
            db.collection(`hospitals/${hospitalId}/staff`).where('departmentId', '==', depId).count().get(),
            db.collection(`hospitals/${hospitalId}/wards`).where('departmentId', '==', depId).count().get(),
        ]);
        const sc = staffCount.data().count;
        const wc = wardCount.data().count;
        if (sc > 0 || wc > 0) {
            return res.status(409).json({ error: `Cannot delete: ${sc} staff member(s) and ${wc} ward(s) still assigned. Move or delete them first.` });
        }

        const ref = db.doc(`hospitals/${hospitalId}/departments/${depId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Department not found' });

        await ref.delete();

        logDataModification('DELETE', 'department', depId, { name: snap.data().name });
        return res.json({ success: true });
    } catch (err) {
        logError('DEPARTMENTS_API', 'Failed to delete department', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
