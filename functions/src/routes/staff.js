import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../config/firebase.js';
import { requireAuth, requireHospital } from '../middleware/auth.js';
import { classifyStaffType } from '../lib/staff-utils.js';
import { logDataModification, logError } from '../lib/logger.js';

const router = Router({ mergeParams: true });

function serializeStaff(id, data, wardsMap) {
    const wardId = data.wardId || (data.departmentId && wardsMap ? wardsMap.get(data.departmentId) : '') || '';
    return {
        _id: id,
        ...data,
        wardId,
        fullName: `${data.firstName || ''} ${data.lastName || ''}`.trim(),
    };
}

// GET /hospitals/:id/staff?departmentId=...&wardId=...
router.get('/', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const { departmentId, wardId } = req.query;

        let query = db.collection(`hospitals/${hospitalId}/staff`).orderBy('lastName').orderBy('firstName');
        if (departmentId) query = query.where('departmentId', '==', departmentId);
        if (wardId) query = query.where('wardId', '==', wardId);

        const [staffSnap, wardSnap] = await Promise.all([
            query.get(),
            db.collection(`hospitals/${hospitalId}/wards`).get(),
        ]);

        const wardsMap = new Map(wardSnap.docs.map((w) => [w.data().departmentId, w.id]));
        return res.json(staffSnap.docs.map((d) => serializeStaff(d.id, d.data(), wardsMap)));
    } catch (err) {
        logError('STAFF_API', 'Failed to list staff', err);
        return res.status(500).json({ error: err.message });
    }
});

// GET /hospitals/:id/staff/:staffId
router.get('/:staffId', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, staffId } = req.params;
        const snap = await db.doc(`hospitals/${hospitalId}/staff/${staffId}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff not found' });
        return res.json(serializeStaff(snap.id, snap.data(), null));
    } catch (err) {
        logError('STAFF_API', 'Failed to fetch staff', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /hospitals/:id/staff
router.post('/', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId } = req.params;
        const body = req.body;

        if (!body.departmentId || !body.wardId) {
            return res.status(400).json({ error: 'Department and ward are required' });
        }
        if (!body.firstName?.trim() || !body.lastName?.trim()) {
            return res.status(400).json({ error: 'First and last name are required' });
        }

        const [hospitalSnap, deptSnap, wardSnap] = await Promise.all([
            db.doc(`hospitals/${hospitalId}`).get(),
            db.doc(`hospitals/${hospitalId}/departments/${body.departmentId}`).get(),
            db.doc(`hospitals/${hospitalId}/wards/${body.wardId}`).get(),
        ]);
        if (!hospitalSnap.exists) return res.status(404).json({ error: 'Hospital not found' });
        if (!deptSnap.exists) return res.status(404).json({ error: 'Department not found' });
        if (!wardSnap.exists) return res.status(404).json({ error: 'Ward not found for this department' });

        const now = new Date().toISOString();
        const staffData = {
            hospitalId,
            departmentId: body.departmentId,
            wardId: body.wardId,
            firstName: body.firstName.trim(),
            lastName: body.lastName.trim(),
            employeeId: body.employeeId?.trim() || '',
            ghanaCardNumber: body.ghanaCardNumber?.trim() || '',
            dateOfBirth: body.dateOfBirth || '',
            gender: body.gender || '',
            phone: body.phone?.trim() || '',
            email: body.email?.trim() || '',
            address: body.address?.trim() || '',
            category: body.category || 'Nurse',
            rank: body.rank?.trim() || '',
            staffType: classifyStaffType(body.rank),
            qualification: body.qualification || '',
            specialization: body.specialization?.trim() || '',
            licenseType: body.licenseType || '',
            licenseNumber: body.licenseNumber?.trim() || '',
            licenseExpiry: body.licenseExpiry || '',
            dateHired: body.dateHired || '',
            employmentStatus: body.employmentStatus || 'Active',
            wardRole: body.wardRole || 'regular',
            workRestriction: body.workRestriction || 'none',
            noNightShift: Boolean(body.noNightShift),
            maternityNoNight: Boolean(body.maternityNoNight),
            preferredOffDays: Array.isArray(body.preferredOffDays) ? body.preferredOffDays : [],
            preferredShifts: Array.isArray(body.preferredShifts) ? body.preferredShifts : [],
            emergencyContact: body.emergencyContact || {},
            annualLeaveBalance: body.annualLeaveBalance ?? 15,
            isRotation: Boolean(body.isRotation),
            leaveRecords: [],
            createdAt: now,
            updatedAt: now,
        };

        const ref = db.collection(`hospitals/${hospitalId}/staff`).doc();
        await ref.set(staffData);

        logDataModification('CREATE', 'staff', ref.id, {
            name: `${staffData.firstName} ${staffData.lastName}`,
            rank: staffData.rank,
        });

        return res.status(201).json(serializeStaff(ref.id, staffData, null));
    } catch (err) {
        logError('STAFF_API', 'Failed to create staff', err);
        return res.status(500).json({ error: err.message });
    }
});

// PATCH /hospitals/:id/staff/:staffId
router.patch('/:staffId', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, staffId } = req.params;
        const ref = db.doc(`hospitals/${hospitalId}/staff/${staffId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff not found' });

        if (req.body.departmentId || req.body.wardId) {
            const current = snap.data();
            const departmentId = req.body.departmentId || current.departmentId;
            const wardId = req.body.wardId || current.wardId;
            const [deptSnap, wardSnap] = await Promise.all([
                db.doc(`hospitals/${hospitalId}/departments/${departmentId}`).get(),
                db.doc(`hospitals/${hospitalId}/wards/${wardId}`).get(),
            ]);
            if (!deptSnap.exists) return res.status(404).json({ error: 'Department not found' });
            if (!wardSnap.exists) return res.status(404).json({ error: 'Ward not found for this department' });
        }

        const allowed = [
            'firstName', 'lastName', 'employeeId', 'ghanaCardNumber', 'dateOfBirth', 'gender',
            'phone', 'email', 'address', 'category', 'rank', 'qualification', 'specialization',
            'licenseType', 'licenseNumber', 'licenseExpiry', 'dateHired', 'employmentStatus',
            'emergencyContact', 'annualLeaveBalance', 'departmentId', 'wardId',
            'wardRole', 'workRestriction', 'noNightShift', 'maternityNoNight',
            'preferredOffDays', 'preferredShifts', 'isRotation',
        ];
        const update = { updatedAt: new Date().toISOString() };
        for (const k of allowed) {
            if (req.body[k] !== undefined) update[k] = req.body[k];
        }
        if (update.rank) update.staffType = classifyStaffType(update.rank);

        await ref.update(update);
        const updated = await ref.get();

        logDataModification('UPDATE', 'staff', staffId, { fields: Object.keys(update) });
        return res.json(serializeStaff(updated.id, updated.data(), null));
    } catch (err) {
        logError('STAFF_API', 'Failed to update staff', err);
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /hospitals/:id/staff/:staffId
router.delete('/:staffId', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, staffId } = req.params;
        const ref = db.doc(`hospitals/${hospitalId}/staff/${staffId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff not found' });
        const staffData = snap.data();
        await ref.delete();

        // Cascade: delete this staff member's assignments from all schedules
        const schedSnap = await db.collection(`hospitals/${hospitalId}/schedules`).get();
        for (const schedDoc of schedSnap.docs) {
            const assignSnap = await schedDoc.ref.collection('assignments').where('staffId', '==', staffId).get();
            if (assignSnap.size > 0) {
                const batch = db.batch();
                assignSnap.docs.forEach((d) => batch.delete(d.ref));
                await batch.commit();
            }
        }

        logDataModification('DELETE', 'staff', staffId, { name: `${staffData.firstName} ${staffData.lastName}` });
        return res.json({ success: true });
    } catch (err) {
        logError('STAFF_API', 'Failed to delete staff', err);
        return res.status(500).json({ error: err.message });
    }
});

// ── Leave sub-resource ──────────────────────────────────────────────────────

// GET /hospitals/:id/staff/:staffId/leave
router.get('/:staffId/leave', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, staffId } = req.params;
        const snap = await db.doc(`hospitals/${hospitalId}/staff/${staffId}`).get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff not found' });
        return res.json(snap.data().leaveRecords || []);
    } catch (err) {
        logError('LEAVE_API', 'Failed to fetch leave', err);
        return res.status(500).json({ error: err.message });
    }
});

// POST /hospitals/:id/staff/:staffId/leave
router.post('/:staffId/leave', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, staffId } = req.params;
        const { startDate, endDate, leaveType, notes } = req.body;

        if (!startDate || !endDate) return res.status(400).json({ error: 'Start and end date are required' });
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return res.status(400).json({ error: 'Invalid date format' });
        if (start > end) return res.status(400).json({ error: 'Start date must be before end date' });

        const ref = db.doc(`hospitals/${hospitalId}/staff/${staffId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff not found' });

        const newRecord = {
            id: randomUUID(),
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            leaveType: leaveType || 'Annual',
            status: 'Approved',
            notes: notes || '',
        };

        const existing = snap.data().leaveRecords || [];
        await ref.update({ leaveRecords: [...existing, newRecord], updatedAt: new Date().toISOString() });

        // Remove conflicting assignments in the leave window from all schedules
        const schedSnap = await db.collection(`hospitals/${hospitalId}/schedules`).get();
        let removedAssignments = 0;
        for (const schedDoc of schedSnap.docs) {
            const assignSnap = await schedDoc.ref.collection('assignments')
                .where('staffId', '==', staffId)
                .get();
            const toDelete = assignSnap.docs.filter((d) => {
                const assignDate = new Date(d.data().date);
                return assignDate >= start && assignDate <= end;
            });
            if (toDelete.length > 0) {
                const batch = db.batch();
                toDelete.forEach((d) => batch.delete(d.ref));
                await batch.commit();
                removedAssignments += toDelete.length;
            }
        }

        const staffData = snap.data();
        logDataModification('CREATE', 'leave', newRecord.id, {
            staffId,
            staffName: `${staffData.firstName} ${staffData.lastName}`,
            startDate,
            endDate,
            type: newRecord.leaveType,
            removedAssignments,
        });

        return res.json({ leaveRecord: newRecord, removedAssignments });
    } catch (err) {
        logError('LEAVE_API', 'Failed to add leave', err);
        return res.status(500).json({ error: err.message });
    }
});

// DELETE /hospitals/:id/staff/:staffId/leave?leaveId=...
router.delete('/:staffId/leave', requireAuth, requireHospital, async (req, res) => {
    try {
        const { id: hospitalId, staffId } = req.params;
        const { leaveId } = req.query;
        if (!leaveId) return res.status(400).json({ error: 'leaveId is required' });

        const ref = db.doc(`hospitals/${hospitalId}/staff/${staffId}`);
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: 'Staff not found' });

        const records = snap.data().leaveRecords || [];
        const filtered = records.filter((l) => l.id !== leaveId);
        if (filtered.length === records.length) return res.status(404).json({ error: 'Leave record not found' });

        await ref.update({ leaveRecords: filtered, updatedAt: new Date().toISOString() });

        const staffData = snap.data();
        logDataModification('DELETE', 'leave', leaveId, {
            staffId,
            staffName: `${staffData.firstName} ${staffData.lastName}`,
        });
        return res.json({ success: true });
    } catch (err) {
        logError('LEAVE_API', 'Failed to remove leave', err);
        return res.status(500).json({ error: err.message });
    }
});

export default router;
