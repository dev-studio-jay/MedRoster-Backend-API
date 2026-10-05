/** GHS nursing/midwifery rank abbreviations used on printed duty rosters. */

export const RANK_ABBR = {
    'Assistant Midwifery Principal': 'AMPS',
    'Principal Midwifery Officer': 'PMO',
    'Senior Midwifery Officer': 'SMO',
    'Midwifery Officer': 'MO',
    'Senior Staff Midwife': 'SSM',
    'Staff Midwife': 'SM',
    'Registered Midwife': 'RM',
    'Midwifery Aid': 'MA',
    'Part-time Midwife': 'PTM',
    'Deputy Director of Nursing Services': 'DDNS',
    'Director of Nursing Services': 'DNS',
    'Director, Nursing & Midwifery Service': 'DNMS',
    'Regional Chief Nursing & Midwifery Officer': 'RCNMO',
    'Deputy Chief Nursing Officer': 'DCNO',
    'Deputy Chief Midwifery Officer': 'DCMO',
    'Principal Nursing Officer': 'PNO',
    'Senior Nursing Officer': 'SNO',
    'Nursing Officer': 'NO',
    'Senior Staff Nurse': 'SSN',
    'Staff Nurse': 'SN',
    'Enrolled Nurse': 'EN',
    'Nurse Assistant Clinical': 'NAC',
    'Nurse Assistant Preventive': 'NAP',
    'Senior Medical Officer': 'SrMO',
    'Medical Officer': 'MedO',
    'House Officer': 'HO',
    'Specialist': 'Spec',
    'Senior Specialist': 'SSpec',
    'Consultant': 'Cons',
    'Senior Consultant': 'SCons',
    'Physician Assistant': 'PA',
    'Senior Physician Assistant': 'SPA',
    'Community Health Nurse': 'CHN',
    'Community Health Nursing Officer': 'CHNO',
};

/** Ambiguous abbreviations resolved toward midwifery (ward roster context). */
const ABBR_TO_RANK = {
    AMPS: 'Assistant Midwifery Principal',
    PMO: 'Principal Midwifery Officer',
    SMO: 'Senior Midwifery Officer',
    MO: 'Midwifery Officer',
    SSM: 'Senior Staff Midwife',
    SM: 'Staff Midwife',
    RM: 'Registered Midwife',
    MA: 'Midwifery Aid',
    PTM: 'Part-time Midwife',
    DDNS: 'Deputy Director of Nursing Services',
    DNS: 'Director of Nursing Services',
    DNMS: 'Director, Nursing & Midwifery Service',
    RCNMO: 'Regional Chief Nursing & Midwifery Officer',
    DCNO: 'Deputy Chief Nursing Officer',
    DCMO: 'Deputy Chief Midwifery Officer',
    PNO: 'Principal Nursing Officer',
    SNO: 'Senior Nursing Officer',
    NO: 'Nursing Officer',
    SSN: 'Senior Staff Nurse',
    SN: 'Staff Nurse',
    EN: 'Enrolled Nurse',
    NAC: 'Nurse Assistant Clinical',
    NAP: 'Nurse Assistant Preventive',
    HO: 'House Officer',
    PA: 'Physician Assistant',
    SPA: 'Senior Physician Assistant',
    CHN: 'Community Health Nurse',
    CHNO: 'Community Health Nursing Officer',
};

export function cleanRankAbbr(raw) {
    return String(raw || '')
        .replace(/[`'".]/g, '')
        .replace(/\s+/g, '')
        .toUpperCase();
}

export function rankFromAbbr(abbr) {
    const key = cleanRankAbbr(abbr);
    return ABBR_TO_RANK[key] || '';
}

export function abbrFromRank(rank) {
    if (!rank) return '';
    if (RANK_ABBR[rank]) return RANK_ABBR[rank];
    const cleaned = cleanRankAbbr(rank);
    if (ABBR_TO_RANK[cleaned]) return cleaned;
    return rank;
}

export function expandRank(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) return { rankAbbr: '', rankFull: '' };
    const fromAbbr = rankFromAbbr(trimmed);
    if (fromAbbr) return { rankAbbr: cleanRankAbbr(trimmed), rankFull: fromAbbr };
    const abbr = RANK_ABBR[trimmed];
    if (abbr) return { rankAbbr: abbr, rankFull: trimmed };
    return { rankAbbr: cleanRankAbbr(trimmed) || trimmed, rankFull: trimmed };
}

export function categoryFromRank(rankFull) {
    const r = String(rankFull || '').toLowerCase();
    if (r.includes('midwif')) return 'Midwife';
    if (r.includes('doctor') || r.includes('medical officer') || r.includes('consultant') || r.includes('specialist') || r.includes('house officer')) {
        return 'Doctor';
    }
    if (r.includes('assistant')) return 'Nurse Assistant';
    return 'Nurse';
}

export function splitFullName(fullName) {
    const parts = String(fullName || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    if (!parts.length) return { firstName: '', lastName: '' };
    if (parts.length === 1) return { firstName: titleCaseName(parts[0]), lastName: titleCaseName(parts[0]) };
    return {
        firstName: titleCaseName(parts[0]),
        lastName: titleCaseName(parts.slice(1).join(' ')),
    };
}

export function titleCaseName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
