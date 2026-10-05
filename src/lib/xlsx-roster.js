import JSZip from 'jszip';

const MONTHS = {
    JANUARY: 0, FEBRUARY: 1, MARCH: 2, APRIL: 3, MAY: 4, JUNE: 5,
    JULY: 6, AUGUST: 7, SEPTEMBER: 8, OCTOBER: 9, NOVEMBER: 10, DECEMBER: 11,
};

const RADIOLOGY_LEGEND = [
    { label: 'M', fill: '', meaning: 'Morning' },
    { label: 'A', fill: '', meaning: 'Afternoon' },
    { label: 'N', fill: '', meaning: 'Night' },
    { label: 'O', fill: '', meaning: 'Off' },
    { label: 'L', fill: '', meaning: 'Leave' },
    { label: 'X', fill: '', meaning: 'General X-ray' },
    { label: 'P', fill: '', meaning: 'Polyclinic X-ray' },
    { label: 'XM', fill: '', meaning: 'Morning' },
    { label: 'XA', fill: '', meaning: 'Afternoon' },
    { label: 'XN', fill: '', meaning: 'Night' },
];

function colLettersToIndex(letters) {
    let n = 0;
    for (const ch of String(letters || '').toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n - 1;
}

function parseRef(ref) {
    const m = String(ref || '').match(/^([A-Z]+)(\d+)$/i);
    if (!m) return { col: -1, row: -1 };
    return { col: colLettersToIndex(m[1]), row: Number(m[2]) };
}

function parseSharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    const siRe = /<si[\s>][\s\S]*?<\/si>/g;
    let si;
    while ((si = siRe.exec(xml))) {
        let text = '';
        const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let t;
        while ((t = tRe.exec(si[0]))) text += t[1];
        out.push(decodeXml(text));
    }
    return out;
}

function decodeXml(s) {
    return String(s || '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function parseFills(stylesXml) {
    if (!stylesXml) return [];
    const fills = [];
    const fillRe = /<fill[\s>][\s\S]*?<\/fill>/g;
    let f;
    while ((f = fillRe.exec(stylesXml))) {
        const rgb = f[0].match(/fgColor[^>]*rgb="([A-Fa-f0-9]+)"/);
        fills.push(rgb ? rgb[1].replace(/^FF/i, '').toUpperCase() : '');
    }
    return fills;
}

function parseCellXfs(stylesXml) {
    if (!stylesXml) return [];
    const block = stylesXml.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/);
    if (!block) return [];
    const ids = [];
    const xfRe = /<xf\b[^>]*>/g;
    let xf;
    while ((xf = xfRe.exec(block[0]))) {
        const m = xf[0].match(/fillId="(\d+)"/);
        ids.push(m ? Number(m[1]) : 0);
    }
    return ids;
}

function innerText(xml) {
    const t = xml.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
    return t.map((x) => decodeXml(x.replace(/<[^>]+>/g, ''))).join('');
}

function parseSheetGrid(sheetXml, sst, fills, fillIds) {
    const cells = [];
    let maxCol = 0;
    let maxRow = 0;
    const cRe = /<c\b([^>]*?)\/>|<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let m;
    while ((m = cRe.exec(sheetXml))) {
        const attrs = m[1] || m[2] || '';
        const body = m[3] || '';
        const refM = attrs.match(/\br="([A-Z]+\d+)"/i);
        if (!refM) continue;
        const { col, row } = parseRef(refM[1]);
        if (col < 0 || row < 0) continue;
        const typeM = attrs.match(/\bt="([^"]+)"/);
        const styleM = attrs.match(/\bs="(\d+)"/);
        const type = typeM ? typeM[1] : '';
        const style = styleM ? Number(styleM[1]) : 0;
        let text = '';
        if (type === 'inlineStr') {
            text = innerText(body);
        } else {
            const v = body.match(/<v>([\s\S]*?)<\/v>/);
            const raw = v ? v[1] : '';
            if (type === 's' && /^\d+$/.test(raw)) text = String(sst[Number(raw)] || '');
            else text = raw;
        }
        const fillId = fillIds[style] ?? 0;
        cells.push({
            col,
            row,
            text: decodeXml(text).replace(/\s+/g, ' ').trim(),
            fill: fills[fillId] || '',
        });
        if (col > maxCol) maxCol = col;
        if (row > maxRow) maxRow = row;
    }
    const grid = Array.from({ length: maxRow + 1 }, () =>
        Array.from({ length: maxCol + 1 }, () => ({ text: '', fill: '' }))
    );
    for (const c of cells) {
        grid[c.row][c.col] = { text: c.text, fill: c.fill };
    }
    return { grid, maxCol, maxRow };
}

function titleFromGrid(grid) {
    const blobs = [];
    for (let r = 1; r < Math.min(grid.length, 8); r++) {
        const line = (grid[r] || []).map((c) => c.text).filter(Boolean).join(' ').trim();
        if (line) blobs.push(line);
    }
    const joined = blobs.join(' | ');
    const m = joined.match(/DUTY ROSTER[^|]{0,80}?[-,]\s*([A-Z]+)\s+(\d{4})/i)
        || joined.match(/\b(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+(\d{4})\b/i);
    const month = m ? m[1].trim() : '';
    const year = m ? Number(m[2]) : null;
    const title = blobs.find((b) => /DUTY ROSTER/i.test(b)) || blobs[1] || blobs[0] || '';
    const unit = blobs.find((b) => /HOSPITAL|DEPARTMENT|RADIOLOGY|WARD/i.test(b) && !/DUTY ROSTER/i.test(b)) || '';
    return { title, unit, month, year };
}

function findDateRow(grid) {
    let best = -1;
    let bestCount = 0;
    for (let r = 1; r < grid.length; r++) {
        const nums = (grid[r] || []).filter((c) => /^\d{1,2}$/.test(c.text));
        if (nums.length > bestCount && nums.length >= 7) {
            bestCount = nums.length;
            best = r;
        }
    }
    return best;
}

const SHIFTISH = /^(XM|XA|XN|PM|PA|PN|SOD|[MANOHLPE]|O|OFF|LV)$/i;

function findNameCol(grid, dateRow) {
    for (let r = 1; r <= dateRow; r++) {
        const idx = (grid[r] || []).findIndex((c) => /STAFF\s*NAME|^NAME$/i.test(c.text));
        if (idx >= 0) return idx;
    }
    for (let r = dateRow + 1; r < grid.length; r++) {
        for (let c = 0; c < Math.min(3, grid[r].length); c++) {
            const t = grid[r][c].text;
            if (/[A-Za-z]{2,}/.test(t) && !SHIFTISH.test(t) && !/WEEK|STAFF|NAME|RANK/i.test(t)) {
                return c;
            }
        }
    }
    return 0;
}

function findRankCol(grid, dateRow) {
    for (let r = Math.max(1, dateRow - 3); r <= dateRow; r++) {
        const idx = (grid[r] || []).findIndex((c) => /^RANK$/i.test(c.text));
        if (idx >= 0) return idx;
    }
    return -1;
}

/**
 * Parse a Ghana duty-roster .xlsx (week-banded Radiology layout or similar) into the same grid shape as Word.
 */
export async function parseXlsxRoster(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    if (!zip.file('xl/workbook.xml')) throw new Error('Not a valid Excel workbook');
    const sstXml = await zip.file('xl/sharedStrings.xml')?.async('string');
    const stylesXml = await zip.file('xl/styles.xml')?.async('string');
    const sheetPath = zip.file('xl/worksheets/sheet1.xml')
        ? 'xl/worksheets/sheet1.xml'
        : Object.keys(zip.files).find((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
    if (!sheetPath) throw new Error('No worksheet found in the Excel file');
    const sheetXml = await zip.file(sheetPath)?.async('string');
    if (!sheetXml) throw new Error('Could not read the Excel sheet');

    const sst = parseSharedStrings(sstXml);
    const fills = parseFills(stylesXml);
    const fillIds = parseCellXfs(stylesXml);
    const { grid } = parseSheetGrid(sheetXml, sst, fills, fillIds);
    if (grid.length < 4) throw new Error('That spreadsheet does not look like a duty roster');

    const titleInfo = titleFromGrid(grid);
    const dateRowIdx = findDateRow(grid);
    if (dateRowIdx < 0) throw new Error('Could not find a date row in the spreadsheet');

    const dateRow = grid[dateRowIdx];
    const dateStart = dateRow.findIndex((c) => /^\d{1,2}$/.test(c.text));
    const nameCol = findNameCol(grid, dateRowIdx);
    const rankCol = findRankCol(grid, dateRowIdx);

    const days = [];
    let monthIndex = MONTHS[String(titleInfo.month || '').toUpperCase()];
    let year = titleInfo.year;
    let prevDay = 0;
    for (let c = Math.max(0, dateStart); c < dateRow.length; c++) {
        const n = Number(dateRow[c].text);
        if (!Number.isFinite(n) || n < 1 || n > 31) continue;
        if (monthIndex == null || !year) {
            days.push({ date: '', dayNum: n, dow: '', weekend: false, col: c });
            continue;
        }
        if (prevDay && n < prevDay) {
            monthIndex += 1;
            if (monthIndex > 11) {
                monthIndex = 0;
                year += 1;
            }
        }
        prevDay = n;
        const d = new Date(Date.UTC(year, monthIndex, n));
        const dow = d.getUTCDay();
        days.push({
            date: d.toISOString().slice(0, 10),
            dayNum: n,
            dow: ['S', 'M', 'T', 'W', 'T', 'F', 'S'][dow],
            weekend: dow === 0 || dow === 6,
            col: c,
        });
    }

    const staffRows = [];
    let no = 0;
    for (let r = dateRowIdx + 1; r < grid.length; r++) {
        const name = (grid[r][nameCol]?.text || '').replace(/\s+/g, ' ').trim();
        if (!/[A-Za-z]{2,}/.test(name)) continue;
        if (/^(STAFF NAME|NAME|RANK|NO|WEEK)$/i.test(name)) continue;
        if (SHIFTISH.test(name)) continue;
        no += 1;
        const rank = rankCol >= 0 ? (grid[r][rankCol]?.text || '') : '';
        const cells = days.map((day) => {
            const cell = grid[r][day.col] || { text: '', fill: '' };
            return {
                text: cell.text,
                fill: cell.fill,
                fontColor: '',
                date: day.date,
                sod: false,
                leaveFill: /^L$/i.test(cell.text),
            };
        });
        const leaveCells = cells.filter((c) => /^L$/i.test(c.text)).length;
        const leaveType = leaveCells >= Math.max(3, Math.floor(days.length / 2))
            ? 'Leave'
            : (leaveCells ? 'Leave' : '');
        staffRows.push({
            no: String(no),
            name,
            rank,
            cells,
            leaveType,
        });
    }

    if (!staffRows.length) throw new Error('No staff rows found in that spreadsheet');

    const monthIdx = MONTHS[String(titleInfo.month || '').toUpperCase()];
    const ym = (titleInfo.year && monthIdx != null)
        ? `${titleInfo.year}-${String(monthIdx + 1).padStart(2, '0')}`
        : '';
    const daysOut = days
        .filter((d) => !ym || !d.date || d.date.startsWith(ym))
        .map(({ col, ...d }) => d);

    return {
        title: titleInfo.title,
        unit: titleInfo.unit,
        month: titleInfo.month,
        year: titleInfo.year,
        days: daysOut,
        legend: RADIOLOGY_LEGEND,
        rows: staffRows.map((row) => ({
            ...row,
            cells: row.cells.filter((c) => !ym || !c.date || c.date.startsWith(ym)),
        })),
    };
}

export { RADIOLOGY_LEGEND };
