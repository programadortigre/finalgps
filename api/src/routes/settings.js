/**
 * Settings Route — Módulo de Pedidos v11
 *
 * GET  /api/settings        → leer todas las configuraciones (APK y Admin)
 * PATCH /api/settings       → actualizar una o varias claves (solo Admin)
 */
'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../db/postgres');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings
// Devuelve configuración global del sistema. Accesible para todos los roles.
// Retorna un objeto {key: value} tipado para consumo directo en APK y Panel.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', auth, async (req, res) => {
    try {
        const result = await db.query('SELECT key, value, type, description FROM system_settings ORDER BY key');

        // Transformar a objeto tipado
        const settings = {};
        for (const row of result.rows) {
            if (row.type === 'boolean') {
                settings[row.key] = row.value === 'true';
            } else if (row.type === 'number') {
                settings[row.key] = parseFloat(row.value);
            } else {
                settings[row.key] = row.value;
            }
        }

        // Para el panel admin: incluir metadata completa
        if (req.user.role === 'admin') {
            return res.json({ settings, raw: result.rows });
        }

        res.json({ settings });
    } catch (err) {
        console.error('[Settings] GET error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/settings
// Actualiza una o varias configuraciones. Solo Admin.
// Body: { "IGV_ENABLED": true, "IGV_PERCENT": 18 }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/', auth, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Solo admins pueden cambiar configuraciones.' });
    }

    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return res.status(400).json({ error: 'Body debe ser un objeto {key: value}.' });
    }

    try {
        const results = {};
        for (const [key, value] of Object.entries(updates)) {
            const strValue = String(value);
            const updated = await db.query(`
                UPDATE system_settings
                SET value = $1, updated_at = NOW()
                WHERE key = $2
                RETURNING key, value, type
            `, [strValue, key]);

            if (updated.rowCount === 0) {
                // Si la clave no existe, ignorar silenciosamente
                results[key] = { status: 'not_found' };
            } else {
                results[key] = { status: 'updated', value: strValue };
            }
        }
        res.json({ success: true, results });
    } catch (err) {
        console.error('[Settings] PATCH error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
