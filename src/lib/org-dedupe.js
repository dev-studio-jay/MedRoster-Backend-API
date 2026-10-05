import { db, batchedDelete, batchedUpdate } from '../config/firebase.js';
import { logDataModification } from './logger.js';

export function normalizeOrgName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function hasNameDuplicates(docs, keyFn) {
    const seen = new Set();
    for (const doc of docs) {
        const key = keyFn(doc);
        if (!key) continue;
        if (seen.has(key)) return true;
        seen.add(key);
    }
    return false;
}

function pickKeeper(docs, scoreFn) {
    return [...docs].sort((a, b) => {
        const score = scoreFn(b) - scoreFn(a);
        if (score !== 0) return score;
        const created = String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
        if (created !== 0) return created;
        return String(a.id).localeCompare(String(b.id));
    })[0];
}

export async function mergeDuplicateOrgUnits(hospitalId) {
    const [deptSnap, wardSnap, staffSnap, schedSnap] = await Promise.all([
        db.collection(`hospitals/${hospitalId}/departments`).get(),
        db.collection(`hospitals/${hospitalId}/wards`).get(),
        db.collection(`hospitals/${hospitalId}/staff`).get(),
        db.collection(`hospitals/${hospitalId}/schedules`).get(),
    ]);

    const departments = deptSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
    const wards = wardSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
    const staff = staffSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
    const schedules = schedSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));

    const needsDeptMerge = hasNameDuplicates(departments, (d) => normalizeOrgName(d.name));
    const needsWardMerge = hasNameDuplicates(
        wards,
        (w) => `${w.departmentId}::${normalizeOrgName(w.name)}`
    );
    if (!needsDeptMerge && !needsWardMerge) return false;

    const wardCountByDept = new Map();
    for (const ward of wards) {
        const key = String(ward.departmentId);
        wardCountByDept.set(key, (wardCountByDept.get(key) || 0) + 1);
    }

    const deptGroups = new Map();
    for (const department of departments) {
        const key = normalizeOrgName(department.name);
        if (!key) continue;
        if (!deptGroups.has(key)) deptGroups.set(key, []);
        deptGroups.get(key).push(department);
    }

    const deptIdMap = new Map();
    const deptsToDelete = [];
    for (const group of deptGroups.values()) {
        const keeper = group.length === 1
            ? group[0]
            : pickKeeper(group, (d) => wardCountByDept.get(String(d.id)) || 0);
        for (const department of group) {
            deptIdMap.set(String(department.id), String(keeper.id));
            if (department.id !== keeper.id) deptsToDelete.push(department.ref);
        }
    }

    const now = new Date().toISOString();
    const wardUpdates = [];
    for (const ward of wards) {
        const nextDept = deptIdMap.get(String(ward.departmentId));
        if (nextDept && nextDept !== String(ward.departmentId)) {
            wardUpdates.push({ ref: ward.ref, data: { departmentId: nextDept, updatedAt: now } });
            ward.departmentId = nextDept;
        }
    }

    const staffCountByWard = new Map();
    for (const person of staff) {
        if (!person.wardId) continue;
        const key = String(person.wardId);
        staffCountByWard.set(key, (staffCountByWard.get(key) || 0) + 1);
    }

    const wardGroups = new Map();
    for (const ward of wards) {
        const key = `${ward.departmentId}::${normalizeOrgName(ward.name)}`;
        if (!wardGroups.has(key)) wardGroups.set(key, []);
        wardGroups.get(key).push(ward);
    }

    const wardIdMap = new Map();
    const wardsToDelete = [];
    for (const group of wardGroups.values()) {
        const keeper = group.length === 1
            ? group[0]
            : pickKeeper(group, (w) => staffCountByWard.get(String(w.id)) || 0);
        for (const ward of group) {
            wardIdMap.set(String(ward.id), String(keeper.id));
            if (ward.id !== keeper.id) wardsToDelete.push(ward.ref);
        }
    }

    const staffUpdates = [];
    for (const person of staff) {
        const nextDept = deptIdMap.get(String(person.departmentId)) || person.departmentId;
        const nextWard = wardIdMap.get(String(person.wardId)) || person.wardId;
        if (String(nextDept) !== String(person.departmentId) || String(nextWard) !== String(person.wardId)) {
            staffUpdates.push({
                ref: person.ref,
                data: { departmentId: nextDept, wardId: nextWard, updatedAt: now },
            });
        }
    }

    const schedUpdates = [];
    const assignmentUpdates = [];
    for (const schedule of schedules) {
        const nextDept = deptIdMap.get(String(schedule.departmentId)) || schedule.departmentId;
        const nextWard = wardIdMap.get(String(schedule.wardId)) || schedule.wardId;
        if (String(nextDept) !== String(schedule.departmentId) || String(nextWard) !== String(schedule.wardId)) {
            schedUpdates.push({
                ref: schedule.ref,
                data: { departmentId: nextDept, wardId: nextWard, updatedAt: now },
            });
        }

        const assignSnap = await schedule.ref.collection('assignments').get();
        for (const assignDoc of assignSnap.docs) {
            const data = assignDoc.data();
            const nextAssignDept = deptIdMap.get(String(data.departmentId)) || data.departmentId;
            const nextAssignWard = wardIdMap.get(String(data.wardId)) || data.wardId;
            if (
                (data.departmentId && String(nextAssignDept) !== String(data.departmentId))
                || (data.wardId && String(nextAssignWard) !== String(data.wardId))
            ) {
                assignmentUpdates.push({
                    ref: assignDoc.ref,
                    data: {
                        ...(data.departmentId ? { departmentId: nextAssignDept } : {}),
                        ...(data.wardId ? { wardId: nextAssignWard } : {}),
                    },
                });
            }
        }
    }

    const updates = [...wardUpdates, ...staffUpdates, ...schedUpdates, ...assignmentUpdates];
    if (!updates.length && !deptsToDelete.length && !wardsToDelete.length) return false;

    if (updates.length) await batchedUpdate(updates);
    if (wardsToDelete.length || deptsToDelete.length) {
        await batchedDelete([...wardsToDelete, ...deptsToDelete]);
    }

    logDataModification('UPDATE', 'org-dedupe', hospitalId, {
        departmentsRemoved: deptsToDelete.length,
        wardsRemoved: wardsToDelete.length,
        staffMoved: staffUpdates.length,
        schedulesMoved: schedUpdates.length,
        assignmentsMoved: assignmentUpdates.length,
    });
    return true;
}
