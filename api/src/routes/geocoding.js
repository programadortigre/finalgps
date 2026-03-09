const express = require('express');
const router = express.Router();

// Simple in-memory cache (1 hour TTL)
const addressCache = new Map();
const CACHE_TTL = 3600000; // 1 hour in milliseconds

const getCachedAddress = (key) => {
    const cached = addressCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.address;
    }
    addressCache.delete(key);
    return null;
};

const setCachedAddress = (key, address) => {
    addressCache.set(key, {
        address,
        timestamp: Date.now()
    });
};

// Reverse geocoding endpoint with caching
router.get('/reverse', async (req, res) => {
    try {
        const { lat, lng } = req.query;
        
        if (!lat || !lng) {
            return res.status(400).json({ error: 'lat and lng are required' });
        }
        
        // Round to 4 decimals for caching (good enough for maps)
        const latRounded = parseFloat(lat).toFixed(4);
        const lngRounded = parseFloat(lng).toFixed(4);
        const cacheKey = `${latRounded},${lngRounded}`;
        
        // Check cache first
        const cached = getCachedAddress(cacheKey);
        if (cached) {
            return res.json({ address: cached, cached: true });
        }
        
        // Fetch from Nominatim with rate limiting
        const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
        
        const response = await fetch(nominatimUrl, {
            headers: {
                'User-Agent': 'finalgps-admin'
            },
            timeout: 5000
        });
        
        if (!response.ok) {
            throw new Error(`Nominatim error: ${response.status}`);
        }
        
        const data = await response.json();
        const address = data.address?.road || 
                       data.address?.street || 
                       data.address?.city ||
                       data.display_name?.split(',')[0] || 
                       `${latRounded}, ${lngRounded}`;
        
        // Cache the result
        setCachedAddress(cacheKey, address);
        
        res.json({ address, cached: false });
    } catch (error) {
        console.error('Geocoding error:', error);
        const { lat, lng } = req.query;
        const fallback = `${parseFloat(lat).toFixed(4)}, ${parseFloat(lng).toFixed(4)}`;
        res.json({ address: fallback, cached: false, error: error.message });
    }
});

module.exports = router;
