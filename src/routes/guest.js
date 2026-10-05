import { Router } from 'express';
import { buildStaffCsvTemplate, mapCsvRowToStaff, parseCsv } from '../lib/staff-csv.js';
import { TIER_LIMITS } from '../lib/tier-limits.js';

const router = Router();

// GET /api/guest/staff/template — public CSV template
router.get('/staff/template', (_req, res) => {
    const csv = buildStaffCsvTemplate();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="medroster-staff-template.csv"');
    return res.send(csv);
});

// POST /api/guest/staff/import — parse only (guest stores in localStorage)
router.post('/staff/import', (req, res) => {
    try {
        const { csvText, fileBase64 } = req.body;
        let text = csvText;
        if (!text && fileBase64) {
            text = Buffer.from(fileBase64, 'base64').toString('utf8');
        }
        if (!text) return res.status(400).json({ error: 'csvText or fileBase64 is required' });

        const maxStaff = TIER_LIMITS.guest.maxStaff;
        const rows = parseCsv(text);
        const imported = [];
        const errors = [];
        rows.forEach((row, idx) => {
            const mapped = mapCsvRowToStaff(row);
            if (mapped.errors.length) {
                errors.push({ row: idx + 2, reason: mapped.errors.join('; ') });
                return;
            }
            if (imported.length >= maxStaff) {
                errors.push({ row: idx + 2, reason: `Guest limit of ${maxStaff} staff reached` });
                return;
            }
            imported.push({
                _id: `guest_${Date.now()}_${idx}`,
                firstName: mapped.firstName,
                lastName: mapped.lastName,
                rank: mapped.rank,
                phone: mapped.phone,
                email: mapped.email,
                annualLeaveDays: mapped.annualLeaveDays,
                notes: mapped.notes,
                departmentName: mapped.departmentName,
                wardName: mapped.wardName,
            });
        });

        return res.json({
            imported: imported.length,
            failed: errors.length,
            staff: imported,
            errors,
            limits: TIER_LIMITS.guest,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/guest/limits
router.get('/limits', (_req, res) => res.json(TIER_LIMITS.guest));

export default router;
