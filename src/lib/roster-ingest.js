import JSZip from 'jszip';
import { parseDocxRoster } from './docx-roster.js';
import { parseXlsxRoster } from './xlsx-roster.js';
import { extractRosterWithOpenAI, interpretRosterGrid, refineExtractWithOpenAI, stripInventedPii } from './roster-extract.js';

function extOf(fileName) {
    const m = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : '';
}

export function sniffRosterKind(buffer, fileName = '') {
    const ext = extOf(fileName);
    const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4B) return ext === 'xlsx' ? 'xlsx' : (ext === 'docx' ? 'docx' : 'zip');
    if (b.length >= 8 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) {
        if (ext === 'xls') return 'xls';
        if (ext === 'doc') return 'doc';
        return 'ole';
    }
    if (b.length >= 4 && b.slice(0, 4).toString('utf8') === '%PDF') return 'pdf';
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'png';
    if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'jpeg';
    if (b.length >= 12 && b.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (ext === 'xlsx' || ext === 'docx' || ext === 'pdf' || ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
        if (ext === 'jpg') return 'jpeg';
        return ext;
    }
    return 'unknown';
}

async function resolveZipKind(buffer, guessed) {
    if (guessed === 'docx' || guessed === 'xlsx') return guessed;
    try {
        const zip = await JSZip.loadAsync(buffer);
        if (zip.file('xl/workbook.xml')) return 'xlsx';
        if (zip.file('word/document.xml')) return 'docx';
    } catch {
        /* ignore */
    }
    return guessed;
}

export async function extractRosterPreview({ buffer, fileName }) {
    let kind = sniffRosterKind(buffer, fileName);
    if (kind === 'zip') kind = await resolveZipKind(buffer, kind);

    if (kind === 'xls') {
        throw new Error('Save the workbook as .xlsx (Excel Workbook) and upload again');
    }
    if (kind === 'doc' || kind === 'ole') {
        throw new Error('Save as .docx, or upload a PDF or photo of the roster');
    }

    if (kind === 'docx' || kind === 'xlsx') {
        const parsed = kind === 'docx' ? await parseDocxRoster(buffer) : await parseXlsxRoster(buffer);
        if (!parsed.rows?.length) throw new Error('No staff rows found in that roster');
        const interpreted = interpretRosterGrid(parsed);
        const refined = await refineExtractWithOpenAI(parsed, interpreted);
        return stripInventedPii(refined);
    }

    if (kind === 'pdf' || kind === 'png' || kind === 'jpeg' || kind === 'webp') {
        const preview = await extractRosterWithOpenAI({ kind, buffer, fileName });
        if (!preview.staff?.length) throw new Error('No staff rows found in that roster');
        return stripInventedPii(preview);
    }

    throw new Error('Upload a Word, Excel, PDF, or photo of the duty roster');
}
