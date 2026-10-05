export function classifyStaffType(rank) {
    if (!rank) return 'regular';
    const r = String(rank).toLowerCase();
    if (r.includes('principal') || r.includes('matron') || r.includes('director') || r.includes('chief')) {
        return 'pno';
    }
    if (
        r.includes('senior') ||
        r.includes('specialist') ||
        r.includes('consultant') ||
        r === 'nursing officer' ||
        r === 'midwifery officer' ||
        r === 'medical officer'
    ) {
        return 'senior';
    }
    return 'regular';
}

export function isSeniorStaff(rank) {
    const t = classifyStaffType(rank);
    return t === 'senior' || t === 'pno';
}

export function staffDisplayName(staff) {
    if (!staff) return '';
    if (staff.fullName) return staff.fullName;
    return `${staff.firstName || ''} ${staff.lastName || ''}`.trim() || 'Unknown';
}

export function compareStaffName(a, b) {
    const last = String(a.lastName || '').localeCompare(String(b.lastName || ''), undefined, { sensitivity: 'base' });
    if (last !== 0) return last;
    return String(a.firstName || '').localeCompare(String(b.firstName || ''), undefined, { sensitivity: 'base' });
}

export function isStaffOnLeave(staff, date) {
    if (!staff?.leaveRecords?.length) return false;
    const check = new Date(date);
    check.setHours(0, 0, 0, 0);
    return staff.leaveRecords.some((leave) => {
        if (leave.status && leave.status !== 'Approved') return false;
        const start = new Date(leave.startDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(leave.endDate);
        end.setHours(23, 59, 59, 999);
        return check >= start && check <= end;
    });
}

export function getStaffById(staffList, staffId) {
    if (!staffList) return null;
    const target = String(staffId);
    return staffList.find((s) => String(s._id || s.id) === target) || null;
}
