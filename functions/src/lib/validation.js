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

export function validateMaxHoursPerWeek({ staffId, assignments, settings }) {
    const maxHours = settings?.maxHoursPerWeek ?? 48;
    const target = String(staffId);
    const own = assignments.filter((a) => String(a.staffId) === target);
    let total = 0;
    own.forEach((a) => {
        const st = a.shiftType;
        if (!st?.startTime || !st?.endTime) return;
        const [sh] = st.startTime.split(':').map(Number);
        const [eh] = st.endTime.split(':').map(Number);
        let hours = eh - sh;
        if (hours < 0) hours += 24;
        total += hours;
    });
    if (total > maxHours) return { valid: true, warning: `Total ${total}h this week (limit: ${maxHours}h)` };
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
    const hoursCheck = validateMaxHoursPerWeek({ staffId: staff._id || staff.id, assignments, settings });
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
        const r = validateMaxHoursPerWeek({ staffId: id, assignments, settings });
        if (r.warning) warnings.push({ type: 'max_hours', staffId: id, staffName: staffDisplayName(sm), message: r.warning, severity: 'warning' });
        if (schedule?.startDate && schedule?.endDate && sm.wardRole === 'regular') {
            const start = new Date(schedule.startDate);
            const end = new Date(schedule.endDate);
            const totalDays = Math.floor((end - start) / (24 * 3600 * 1000)) + 1;
            const targetOffDays = Math.min(totalDays, 12 + holidayKeys(schedule).size);
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
