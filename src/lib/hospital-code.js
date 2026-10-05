/** Generate and validate hospital join codes (e.g. KBU-X7F). */

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function generateHospitalCode() {
    let raw = '';
    for (let i = 0; i < 6; i++) {
        raw += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

/** Normalize user input to uppercase alphanumeric with optional hyphen. */
export function normalizeJoinCode(code) {
    if (!code || typeof code !== 'string') return '';
    const cleaned = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned.length < 6 || cleaned.length > 9) return cleaned;
    if (cleaned.length === 6) return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
    return cleaned;
}

export function isValidJoinCodeFormat(code) {
    const n = normalizeJoinCode(code);
    // Stored form: 6–9 alphanumeric, optional single hyphen groups
    return /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(n) || /^[A-Z0-9]{6,9}$/.test(n.replace(/-/g, ''));
}

/** Unique lookup field without hyphen for indexing. */
export function joinCodeKey(code) {
    return normalizeJoinCode(code).replace(/-/g, '');
}
