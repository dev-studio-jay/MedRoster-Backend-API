import { expandRank, splitFullName } from './rank-abbr.js';

const SHIFT_ALIASES = {
    M: 'Morning',
    MORNING: 'Morning',
    'MORNING DUTY': 'Morning',
    DAY: 'Morning',
    D: 'Morning',
    A: 'Afternoon',
    AFTERNOON: 'Afternoon',
    'AFTERNOON DUTY': 'Afternoon',
    EVENING: 'Afternoon',
    E: 'Afternoon',
    N: 'Night',
    NIGHT: 'Night',
    'NIGHT DUTY': 'Night',
    N12: 'Night',
    O: 'Off',
    OFF: 'Off',
    'OFF DUTY': 'Off',
    'D/O': 'Off',
    DO: 'Off',
    'N/O': 'Off',
    NOFF: 'Off',
    H: 'Holiday',
    'H/O': 'Holiday',
    HO: 'Holiday',
    PH: 'Holiday',
    SOD: 'SOD',
    LV: 'Leave',
    AL: 'Leave',
    SL: 'Leave',
    PTO: 'Leave',
};

function normalizeCellCode(raw, legend) {
    const text = String(raw || '').trim();
    if (!text) return '';
    const upper = text.toUpperCase().replace(/\s+/g, ' ');
    if (upper === 'D/O' || upper === 'N/O' || upper === 'H/O') {
        return SHIFT_ALIASES[upper];
    }
    if (upper === 'DAY SUP' || upper === 'DAYSUP') return 'Morning';
    if (legend?.length) {
        const hit = legend.find((l) => String(l.label || '').toUpperCase() === upper);
        if (hit?.meaning) return hit.meaning;
    }
    if (SHIFT_ALIASES[upper]) return SHIFT_ALIASES[upper];
    if (SHIFT_ALIASES[upper.replace(/\s+/g, '')]) return SHIFT_ALIASES[upper.replace(/\s+/g, '')];
    return '';
}

function codeLetter(meaning) {
    if (meaning === 'Morning') return 'M';
    if (meaning === 'Afternoon') return 'A';
    if (meaning === 'Night') return 'N';
    if (meaning === 'Off') return 'O';
    if (meaning === 'Holiday') return 'H';
    if (meaning === 'SOD') return 'SOD';
    if (meaning === 'Leave') return 'LV';
    return '';
}

export function interpretRosterGrid(parsed) {
    const staff = parsed.rows.map((row) => {
        const names = splitFullName(row.name);
        const ranks = expandRank(row.rank);
        const leaveType = row.leaveType || '';
        const joinedLetters = (row.cells || []).map((c) => c.text).join('').replace(/[^A-Za-z]/g, '').toUpperCase();
        const fullLeaveRow = Boolean(leaveType) && /MATERNITYLEAVE|STUDYLEAVE/.test(joinedLetters);
        const assignments = [];
        const cells = [];

        for (const cell of row.cells) {
            if (!cell.date) continue;
            const meaning = normalizeCellCode(cell.text, parsed.legend);
            const exactDuty = /^[MANOH]$/i.test(cell.text) || /^(SOD|D\/O|N\/O|H\/O|OFF)$/i.test(cell.text);
            if (fullLeaveRow || (leaveType && !exactDuty)) {
                cells.push({ date: cell.date, code: 'LV', sod: false, text: cell.text });
                continue;
            }
            const code = codeLetter(meaning) || (cell.text.length <= 3 ? cell.text.toUpperCase() : '');
            const sod = Boolean(cell.sod) || meaning === 'SOD';
            cells.push({ date: cell.date, code, sod, text: cell.text });
            if (meaning === 'Morning' || meaning === 'Afternoon' || meaning === 'Night' || meaning === 'SOD') {
                assignments.push({ date: cell.date, code: codeLetter(meaning === 'SOD' ? 'SOD' : meaning), sod });
            }
        }

        return {
            no: row.no,
            fullName: row.name,
            firstName: names.firstName,
            lastName: names.lastName,
            rankAbbr: ranks.rankAbbr,
            rankFull: ranks.rankFull || row.rank,
            selected: true,
            wardRole: ranks.rankAbbr === 'AMPS' || ranks.rankAbbr === 'PMO' || ranks.rankAbbr === 'PNO' ? 'incharge' : 'regular',
            leaveType,
            leaveNote: leaveType ? `${leaveType} leave` : '',
            cells,
            assignments: assignments,
        };
    });

    return {
        source: 'roster',
        title: parsed.title,
        unit: parsed.unit,
        month: parsed.month,
        year: parsed.year,
        days: parsed.days,
        legend: parsed.legend,
        staff,
        aiUsed: false,
    };
}

const EXTRACT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        staff: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    no: { type: 'string' },
                    firstName: { type: 'string' },
                    lastName: { type: 'string' },
                    rankAbbr: { type: 'string' },
                    rankFull: { type: 'string' },
                    leaveType: { type: 'string' },
                    leaveNote: { type: 'string' },
                    wardRole: { type: 'string' },
                    cells: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            properties: {
                                date: { type: 'string' },
                                code: { type: 'string' },
                                sod: { type: 'boolean' },
                            },
                            required: ['date', 'code', 'sod'],
                        },
                    },
                },
                required: ['no', 'firstName', 'lastName', 'rankAbbr', 'rankFull', 'leaveType', 'leaveNote', 'wardRole', 'cells'],
            },
        },
    },
    required: ['staff'],
};

function buildPrompt(parsed, interpreted) {
    return `You extract Ghana hospital duty-roster data. Return JSON only.

This file's footer legend (trust first):
${JSON.stringify(parsed.legend, null, 0)}

Default Delivery Suite contract:
- Grid: NO | NAME | RANK | one cell per calendar date
- Letters: M morning, A afternoon, N night, O off, H holiday
- Weekend column shading is not a shift
- SOD is a flag, not a new shift unless the cell text is SOD
- DAY SUP is morning + supervisor
- Leave spelled across cells (MATERNITY LEAVE, PART LEAVE, STUDY LEAVE) is a leave note, not M/A/N assignments
- Aliases: D/O N/O H/O = off/holiday; E = afternoon; Day (not D/O) = morning; P = afternoon only if the legend says so
- Expand rank codes (SSM=Senior Staff Midwife, AMPS, SMO, MO, SM, SSN, RM, PMO, PNO, SNO, NO, DCNO, DNMS)
- Never output Ghana Card, staff ID, or license numbers
- Fix SSM\` typos as SSM
- Title-case names; first token is firstName, remainder lastName

Parsed grid (already split into staff rows and dates):
${JSON.stringify({
        title: parsed.title,
        month: parsed.month,
        year: parsed.year,
        days: parsed.days,
        staff: interpreted.staff.map((s) => ({
            no: s.no,
            name: s.fullName,
            rank: s.rankAbbr,
            leaveType: s.leaveType,
            cells: s.cells.map((c) => ({ date: c.date, text: c.text, code: c.code, sod: c.sod })),
        })),
    })}

Correct names, ranks, leave, and cell codes (M A N O H LV SOD). Keep one staff object per input row.`;
}

export async function refineExtractWithOpenAI(parsed, interpreted) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return interpreted;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
                temperature: 0,
                response_format: {
                    type: 'json_schema',
                    json_schema: { name: 'roster_extract', strict: true, schema: EXTRACT_SCHEMA },
                },
                messages: [
                    { role: 'system', content: 'You convert duty-roster grids into structured staff and shift cells. No IDs.' },
                    { role: 'user', content: buildPrompt(parsed, interpreted) },
                ],
            }),
            signal: controller.signal,
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.warn('OpenAI extract failed', res.status, errText.slice(0, 400));
            return interpreted;
        }
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content) return interpreted;
        const parsedAi = JSON.parse(content);
        return mergeAiExtract(interpreted, parsedAi);
    } catch (err) {
        console.warn('OpenAI extract skipped', err.message);
        return interpreted;
    } finally {
        clearTimeout(timer);
    }
}

function mergeAiExtract(base, ai) {
    const byNo = new Map((ai.staff || []).map((s) => [String(s.no), s]));
    const staff = base.staff.map((row) => {
        const extra = byNo.get(String(row.no));
        if (!extra) return row;
        const cells = (extra.cells?.length ? extra.cells : row.cells).map((c) => ({
            date: c.date,
            code: String(c.code || '').toUpperCase(),
            sod: Boolean(c.sod),
            text: c.text || c.code || '',
        }));
        const leaveType = extra.leaveType || row.leaveType || '';
        const assignments = cells
            .filter((c) => ['M', 'A', 'N', 'SOD'].includes(c.code))
            .map((c) => ({ date: c.date, code: c.code, sod: c.sod || c.code === 'SOD' }));
        return {
            ...row,
            firstName: extra.firstName || row.firstName,
            lastName: extra.lastName || row.lastName,
            fullName: `${extra.firstName || row.firstName} ${extra.lastName || row.lastName}`.trim(),
            rankAbbr: extra.rankAbbr || row.rankAbbr,
            rankFull: extra.rankFull || row.rankFull,
            leaveType,
            leaveNote: extra.leaveNote || row.leaveNote,
            wardRole: extra.wardRole === 'incharge' || extra.wardRole === 'assistant' ? extra.wardRole : row.wardRole,
            cells,
            assignments,
        };
    });
    return { ...base, staff, aiUsed: true };
}

const PII_RE = /ghana\s*card|license\s*(number|no)|employee\s*id|pin\s*-|ain\s*-/i;

export function stripInventedPii(preview) {
    return {
        ...preview,
        staff: (preview.staff || []).map((s) => {
            const clone = { ...s };
            for (const k of Object.keys(clone)) {
                if (PII_RE.test(k) || PII_RE.test(String(clone[k] || ''))) {
                    if (['firstName', 'lastName', 'fullName', 'rankAbbr', 'rankFull', 'leaveNote'].includes(k)) continue;
                    if (typeof clone[k] === 'string' && PII_RE.test(clone[k]) && !['firstName', 'lastName', 'fullName'].includes(k)) {
                        clone[k] = '';
                    }
                }
            }
            delete clone.ghanaCardNumber;
            delete clone.employeeId;
            delete clone.licenseNumber;
            return clone;
        }),
    };
}
