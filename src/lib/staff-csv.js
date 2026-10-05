/** CSV staff template helpers and simple CSV parse. */

export const STAFF_CSV_HEADERS = [
    'No',
    'Full Name',
    'Rank',
    'Phone',
    'Email',
    'Department',
    'Ward',
    'Annual Leave Days',
    'Notes',
];

export const STAFF_CSV_EXAMPLE_ROWS = [
    ['1', 'Joana P. Otoo', 'Assistant Midwifery Principal', '0241234567', 'jotoo@hospital.gh', 'Maternity', 'Delivery Suite', '12', ''],
    ['2', 'Denicia A. Moro', 'Senior Midwifery Officer', '0245678901', '', 'Maternity', 'Delivery Suite', '10', ''],
    ['3', 'Kwame Mensah', 'Staff Nurse', '0201112233', 'kmensah@hospital.gh', 'Medicine & Therapeutics', 'Male Medical Ward', '14', ''],
];

export function buildStaffCsvTemplate({ departments = [], wards = [] } = {}) {
    const lines = [STAFF_CSV_HEADERS.join(',')];
    for (const row of STAFF_CSV_EXAMPLE_ROWS) {
        lines.push(row.map(csvEscape).join(','));
    }
    if (departments.length || wards.length) {
        lines.push('');
        lines.push('# Available departments (reference only — delete this section before upload):');
        for (const d of departments) lines.push(`# ${csvEscape(d.name || d)}`);
        if (wards.length) {
            lines.push('# Available wards:');
            for (const w of wards) lines.push(`# ${csvEscape(w.name || w)}`);
        }
    }
    return lines.join('\n') + '\n';
}

function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

/** Minimal CSV parser (handles quotes). Returns array of objects keyed by header. */
export function parseCsv(text) {
    const rows = [];
    let i = 0;
    const len = text.length;

    function readCell() {
        if (text[i] === '"') {
            i++;
            let cell = '';
            while (i < len) {
                if (text[i] === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
                if (text[i] === '"') { i++; break; }
                cell += text[i++];
            }
            if (text[i] === ',') i++;
            return cell;
        }
        let cell = '';
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') cell += text[i++];
        if (text[i] === ',') i++;
        return cell.trim();
    }

    function readRow() {
        if (i >= len) return null;
        if (text[i] === '#') {
            while (i < len && text[i] !== '\n') i++;
            if (text[i] === '\n') i++;
            return readRow();
        }
        const cells = [];
        while (i < len) {
            cells.push(readCell());
            if (text[i] === '\r') i++;
            if (text[i] === '\n') { i++; break; }
            if (i >= len) break;
            if (text[i] !== ',' && cells.length && text[i - 1] !== ',') break;
        }
        if (cells.every((c) => !c)) return readRow();
        return cells;
    }

    const header = readRow();
    if (!header) return [];
    while (i < len) {
        const cells = readRow();
        if (!cells) break;
        const obj = {};
        header.forEach((h, idx) => { obj[h.trim()] = cells[idx] ?? ''; });
        rows.push(obj);
    }
    return rows;
}

export function mapCsvRowToStaff(row) {
    const fullName = (row['Full Name'] || row.fullName || row.Name || '').trim();
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || '';
    const lastName = parts.slice(1).join(' ') || (row['Last Name'] || '');
    const rank = (row.Rank || row.rank || '').trim();
    const phone = (row.Phone || row.phone || '').trim();
    const email = (row.Email || row.email || '').trim();
    const departmentName = (row.Department || row.department || '').trim();
    const wardName = (row.Ward || row.ward || '').trim();
    const leaveDays = parseInt(row['Annual Leave Days'] || row.leaveDays || '0', 10) || 0;
    const notes = (row.Notes || row.notes || '').trim();

    const errors = [];
    if (!firstName) errors.push('Missing first name');
    if (!lastName && parts.length < 2) errors.push('Missing last name');
    if (!rank) errors.push('Missing rank');

    return {
        firstName,
        lastName: lastName || firstName,
        rank,
        phone,
        email,
        departmentName,
        wardName,
        annualLeaveDays: leaveDays,
        notes,
        errors,
    };
}
