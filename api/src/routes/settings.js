/**
 * settings.js — Rutas de Configuración Global del Sistema
 *
 * GET  /api/settings        — Obtiene todas las configuraciones
 * PATCH /api/settings       — Actualiza una o varias configuraciones (admin only)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('../db/postgres');
const auth    = require('../middleware/auth');

// GET /api/settings — Accesible para todos los roles autenticados (APK, Admin)
router.get('/', auth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT key, value, type, description FROM system_settings ORDER BY key'
        );
        // Transformar a objeto key:value para facilitar uso en frontend/APK
        const settings = {};
        for (const row of result.rows) {
            let parsed = row.value;
            if (row.type === 'boolean') parsed = row.value === 'true';
            else if (row.type === 'number') parsed = parseFloat(row.value);
            else if (row.type === 'json') { try { parsed = JSON.parse(row.value); } catch (_) {} }
            settings[row.key] = { value: parsed, type: row.type, description: row.description };
        }
        res.json(settings);
    } catch (err) {
        console.error('[SETTINGS] GET error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// PATCH /api/settings — Solo admin puede modificar
router.patch('/', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const updates = req.body; // { KEY: value, KEY2: value2 }
    if (!updates || typeof updates !== 'object' || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Body debe ser un objeto { KEY: value }' });
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        const updated = [];

        for (const [key, rawValue] of Object.entries(updates)) {
            const existing = await client.query(
                'SELECT key, value, type FROM system_settings WHERE key = $1', [key]
            );
            if (existing.rows.length === 0) {
                // Si no existe, insertar con tipo 'string' por defecto
                await client.query(
                    `INSERT INTO system_settings (key, value, type) VALUES ($1, $2, 'string')
                     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
                    [key, String(rawValue)]
                );
            } else {
                const stringVal = String(rawValue);
                await client.query(
                    'UPDATE system_settings SET value = $1, updated_at = NOW() WHERE key = $2',
                    [stringVal, key]
                );
            }

            // Audit log
            await client.query(`
                INSERT INTO audit_logs (entity_type, entity_id, action, old_value, new_value, performed_by)
                VALUES ('setting', NULL, 'update', $1, $2, $3)
            `, [
                JSON.stringify({ key, value: existing.rows[0]?.value }),
                JSON.stringify({ key, value: rawValue }),
                req.user.id
            ]);

            updated.push(key);
        }

        await client.query('COMMIT');
        res.json({ success: true, updated });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[SETTINGS] PATCH error:', err.message);
        res.status(500).json({ error: 'Internal server error' });
    } finally {
        client.release();
    }
});

module.exports = router;
