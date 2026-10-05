import { isStaffOnLeave, classifyStaffType, staffDisplayName, getStaffById } from './staff-utils.js';

function resolveStaffType(staff) {
    return staff?.staffType || classifyStaffType(staff?.rank);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dateKey(date) {
    return new Date(date).toISOString().split('T')[0];
}

function shiftName(shiftType) {
    return shiftType?.name || '';
}

function isNightShift(shiftType) {
    return shiftName(shiftType) === 'Night';
}

function isWeekend(date) {
    const d = new Date(date).getDay();
    return d === 0 || d === 6;
}

function holidayKeys(schedule) {
    return new Set((schedule?.holidays || []).map((h) => dateKey(h.date || h)));
}

/** Hours covered by a shift, including overnight (end before start). */
export function shiftDurationHours(shiftType) {
    if (!shiftType?.startTime || !shiftType?.endTime) return 0;
    const [sh, sm = 0] = String(shiftType.startTime).split(':').map(Number);
    const [eh, em = 0] = String(shiftType.endTime).split(':').map(Number);
    if (Number.isNaN(sh) || Number.isNaN(eh)) return 0;
    let hours = (eh + em / 60) - (sh + sm / 60);
    if (hours <= 0) hours += 24;
    return hours;
}

function timeToMinutes(time) {
    const [h, m = 0] = String(time || '00:00').split(':').map(Number);
    return ((h || 0) * 60) + (m || 0);
}

/** True when two shifts share any open interval of time. Adjacent (end === start) does not overlap. */
export function shiftsOverlap(a, b) {
    if (!a?.startTime || !a?.endTime || !b?.startTime || !b?.endTime) return false;
    let aStart = timeToMinutes(a.startTime);
    let aEnd = timeToMinutes(a.endTime);
    let bStart = timeToMinutes(b.startTime);
    let bEnd = timeToMinutes(b.endTime);
    if (aEnd <= aStart) aEnd += 24 * 60;
    if (bEnd <= bStart) bEnd += 24 * 60;
    return aStart < bEnd && bStart < aEnd;
}

/** Monthly off-day target is 12. Scale it to the cycle length, then add holidays. */
export function scaledOffDayTarget(cycleDays, holidayCount = 0) {
    const monthlyOff = 12;
    const scaled = Math.round((monthlyOff * cycleDays) / 31);
    return Math.min(cycleDays, Math.max(0, scaled + holidayCount));
}

function weekStartContaining(date, scheduleStart) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const s = new Date(scheduleStart);
    s.setHours(0, 0, 0, 0);
    const diffDays = Math.round((d - s) / (24 * 3600 * 1000));
    const week = Math.floor(Math.max(0, diffDays) / 7);
    const start = new Date(s);
    start.setDate(start.getDate() + week * 7);
    return start;
}

function earliestAssignmentDate(assignments) {
    let min = null;
    for (const a of assignments) {
        const d = new Date(a.date);
        if (Number.isNaN(d.getTime())) continue;
        d.setHours(0, 0, 0, 0);
        if (!min || d < min) min = d;
    }
    return min || new Date();
}

/** Hours this person already has in the 7-day window that contains `date`. */
export function hoursForStaffInWeekContaining({ assignments, staffId, date, scheduleStart }) {
    const target = String(staffId);
    const weekStart = weekStartContaining(date, scheduleStart);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    let total = 0;
    for (const a of assignments) {
        if (String(a.staffId) !== target) continue;
        const ad = new Date(a.date);
        ad.setHours(0, 0, 0, 0);
        if (ad >= weekStart && ad < weekEnd) total += shiftDurationHours(a.shiftType);
    }
    return total;
}

function isHoliday(date, schedule) {
    return holidayKeys(schedule).has(dateKey(date));
}

export function validateLeaveConflict(staff, date) {
    if (!staff) return { valid: false, error: 'Staff member not found' };
    if (isStaffOnLeave(staff, date)) {
        const dateStr = new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        return { valid: false, error: `${staffDisplayName(staff)} is on leave on ${dateStr}` };
    }
    return { valid: true };
}

export function validateRoleShiftCompatibility(staff, shiftType) {
    if (!staff || !shiftType) return { valid: true };
    if (
        isNightShift(shiftType) &&
        (staff.noNightShift || staff.maternityNoNight || staff.wardRole === 'incharge' || staff.wardRole === 'assistant')
    ) {
        return { valid: false, error: `${staffDisplayName(staff)} cannot be assigned to night shifts` };
    }
    return { valid: true };
}

export function validateWorkRestriction(staff, date, shiftType, schedule) {
    if (!staff || !shiftType) return { valid: true };
    const name = shiftName(shiftType);
    const restriction = staff.workRestriction || 'none';

    if ((staff.wardRole === 'incharge' || staff.wardRole === 'assistant') && name !== 'Morning') {
        return { valid: false, error: `${staffDisplayName(staff)} is ${staff.wardRole} and should work morning shifts only` };
    }
    if ((staff.wardRole === 'incharge' || staff.wardRole === 'assistant') && isWeekend(date)) {
        return { valid: false, error: `${staffDisplayName(staff)} is ${staff.wardRole} and should not work weekends` };
    }
    if ((staff.wardRole === 'incharge' || staff.wardRole === 'assistant') && isHoliday(date, schedule)) {
        return { valid: false, error: `${staffDisplayName(staff)} is ${staff.wardRole} and should be off on marked holidays` };
    }
    if (restriction === 'onlyMorning' && name !== 'Morning') {
        return { valid: false, error: `${staffDisplayName(staff)} is restricted to morning shifts` };
    }
    if (restriction === 'onlyAfternoon' && name !== 'Afternoon') {
        return { valid: false, error: `${staffDisplayName(staff)} is restricted to afternoon shifts` };
    }
    if ((restriction === 'weekdayOnly' || restriction === 'studyLeave') && isWeekend(date)) {
        return { valid: false, error: `${staffDisplayName(staff)} should not work weekend shifts` };
    }
    return { valid: true };
}

export function validateSupervisoryCoverage({ date, assignments, staffById, settings }) {
    const minSeniorStaff = settings?.minSeniorStaffPerDay ?? 1;
    const dateStr = dateKey(date);
    const dayAssignments = assignments.filter((a) => dateKey(a.date) === dateStr);
    const seniorCount = dayAssignments.filter((a) => {
        const staff = staffById.get(String(a.staffId));
        if (!staff) return false;
        const type = resolveStaffType(staff);
        return type === 'senior' || type === 'pno';
    }).length;

    if (seniorCount < minSeniorStaff) {
        const dateFormatted = new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
        return { valid: false, error: `${dateFormatted} needs at least ${minSeniorStaff} senior staff (currently ${seniorCount})`, missingCount: minSeniorStaff - seniorCount };
    }
    return { valid: true };
}

export function validateMaxHoursPerWeek({ staffId, assignments, settings, schedule }) {
    const maxHours = settings?.maxHoursPerWeek ?? 48;
    const target = String(staffId);
    const own = assignments.filter((a) => String(a.staffId) === target);
    if (!own.length) return { valid: true };

    const scheduleStart = schedule?.startDate || earliestAssignmentDate(own);
    const byWeek = new Map();
    for (const a of own) {
        const key = weekStartContaining(a.date, scheduleStart).toISOString().split('T')[0];
        byWeek.set(key, (byWeek.get(key) || 0) + shiftDurationHours(a.shiftType));
    }
    let worst = 0;
    for (const hours of byWeek.values()) {
        if (hours > worst) worst = hours;
    }
    if (worst > maxHours) {
        return { valid: true, warning: `Total ${Math.round(worst)}h in a 7-day window (limit: ${maxHours}h)` };
    }
    return { valid: true };
}

export function validateConsecutiveShifts({ staffId, date, assignments, settings }) {
    const maxDays = settings?.maxConsecutiveDays ?? 6;
    const maxNights = settings?.maxConsecutiveNights ?? 3;
    const target = String(staffId);
    const own = assignments.filter((a) => String(a.staffId) === target).sort((a, b) => new Date(a.date) - new Date(b.date));
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);

    let consecutive = 1;
    let cur = new Date(checkDate);
    cur.setDate(cur.getDate() - 1);
    while (consecutive < maxDays + 2) {
        const ds = dateKey(cur);
        if (!own.some((a) => dateKey(a.date) === ds)) break;
        consecutive++;
        cur.setDate(cur.getDate() - 1);
    }
    if (consecutive > maxDays) return { valid: true, warning: `${consecutive} consecutive days of work` };

    const today = own.find((a) => dateKey(a.date) === dateKey(checkDate));
    if (today?.shiftType?.name === 'Night') {
        let nights = 1;
        let nd = new Date(checkDate);
        nd.setDate(nd.getDate() - 1);
        while (nights < maxNights + 2) {
            const ds = dateKey(nd);
            if (!own.find((a) => dateKey(a.date) === ds && a.shiftType?.name === 'Night')) break;
            nights++;
            nd.setDate(nd.getDate() - 1);
        }
        if (nights > maxNights) return { valid: true, warning: `${nights} consecutive night shifts; fourth nights should only be used with caution` };
    }
    return { valid: true };
}

export function validateAssignment({ staff, date, shiftType, context }) {
    const errors = [];
    const warnings = [];
    if (!staff) return { valid: false, errors: ['Staff member not found'], warnings: [] };
    if (!shiftType) return { valid: false, errors: ['Shift type not found'], warnings: [] };

    const settings = context?.settings || {};
    const rules = settings.validationRules || {};
    const assignments = context?.assignments || [];
    const schedule = context?.schedule;

    if (rules.enforceLeaveConflicts !== false) {
        const r = validateLeaveConflict(staff, date);
        if (!r.valid) errors.push(r.error);
    }
    if (rules.enforceRoleShiftRestrictions !== false) {
        const r = validateRoleShiftCompatibility(staff, shiftType);
        if (!r.valid) errors.push(r.error);
        const restriction = validateWorkRestriction(staff, date, shiftType, schedule);
        if (!restriction.valid) errors.push(restriction.error);
    }
    if (rules.warnConsecutiveShifts !== false) {
        const r = validateConsecutiveShifts({ staffId: staff._id || staff.id, date, assignments, settings });
        if (r.warning) warnings.push(r.warning);
    }
    const hoursCheck = validateMaxHoursPerWeek({
        staffId: staff._id || staff.id,
        assignments: [...assignments, { staffId: staff._id || staff.id, date, shiftType }],
        settings,
        schedule,
    });
    if (hoursCheck.warning) warnings.push(hoursCheck.warning);

    return { valid: errors.length === 0, errors, warnings };
}

export function validateFullSchedule({ staff, assignments, settings, schedule }) {
    const errors = [];
    const warnings = [];
    const dateViolations = {};
    const rules = settings?.validationRules || {};
    const staffById = new Map((staff || []).map((s) => [String(s._id || s.id), s]));
    const dates = [...new Set((assignments || []).map((a) => dateKey(a.date)))];

    dates.forEach((dateStr) => {
        const date = new Date(dateStr);
        if (rules.enforceSupervisoryCoverage !== false) {
            const r = validateSupervisoryCoverage({ date, assignments, staffById, settings });
            if (!r.valid) {
                errors.push({ type: 'supervisory_coverage', date: dateStr, message: r.error, severity: 'error' });
                if (!dateViolations[dateStr]) dateViolations[dateStr] = [];
                dateViolations[dateStr].push('missing_supervisor');
            }
        }
        const dayAssignments = assignments.filter((a) => dateKey(a.date) === dateStr);
        dayAssignments.forEach((a) => {
            const sm = staffById.get(String(a.staffId));
            if (!sm) return;
            if (rules.enforceLeaveConflicts !== false && isStaffOnLeave(sm, date)) {
                errors.push({ type: 'leave_conflict', date: dateStr, staffId: String(sm._id || sm.id), staffName: staffDisplayName(sm), message: `${staffDisplayName(sm)} is on leave`, severity: 'error' });
            }
            if (rules.enforceRoleShiftRestrictions !== false && a.shiftType) {
                const r = validateRoleShiftCompatibility(sm, a.shiftType);
                if (!r.valid) errors.push({ type: 'role_shift_incompatible', date: dateStr, staffId: String(sm._id || sm.id), staffName: staffDisplayName(sm), message: r.error, severity: 'error' });
                const restriction = validateWorkRestriction(sm, date, a.shiftType, schedule);
                if (!restriction.valid) errors.push({ type: 'work_restriction', date: dateStr, staffId: String(sm._id || sm.id), staffName: staffDisplayName(sm), message: restriction.error, severity: 'error' });
            }
        });
    });

    (staff || []).forEach((sm) => {
        const id = String(sm._id || sm.id);
        const own = assignments.filter((a) => String(a.staffId) === id);
        if (!own.length) return;
        const r = validateMaxHoursPerWeek({ staffId: id, assignments, settings, schedule });
        if (r.warning) warnings.push({ type: 'max_hours', staffId: id, staffName: staffDisplayName(sm), message: r.warning, severity: 'warning' });
        if (schedule?.startDate && schedule?.endDate && sm.wardRole === 'regular') {
            const start = new Date(schedule.startDate);
            const end = new Date(schedule.endDate);
            const totalDays = Math.floor((end - start) / (24 * 3600 * 1000)) + 1;
            const targetOffDays = scaledOffDayTarget(totalDays, holidayKeys(schedule).size);
            const workedDays = new Set(own.map((a) => dateKey(a.date))).size;
            const offDays = totalDays - workedDays;
            if (offDays < targetOffDays) {
                warnings.push({ type: 'off_day_target', staffId: id, staffName: staffDisplayName(sm), message: `${offDays} off days in this cycle (target: ${targetOffDays})`, severity: 'warning' });
            }
        }
    });

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        dateViolations,
        summary: {
            totalErrors: errors.length,
            totalWarnings: warnings.length,
            leaveConflicts: errors.filter((e) => e.type === 'leave_conflict').length,
            roleViolations: errors.filter((e) => e.type === 'role_shift_incompatible').length,
            coverageIssues: errors.filter((e) => e.type === 'supervisory_coverage').length,
            restrictionViolations: errors.filter((e) => e.type === 'work_restriction').length,
        },
    };
}

export { getStaffById };
