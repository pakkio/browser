async function getCacheStats(req, res, cache) {
    try {
        const stats = await cache.getStats();
        const formattedStats = {
            ...stats,
            totalSizeFormatted: `${(stats.totalSize / 1024 / 1024).toFixed(1)} MB`,
            categories: Object.keys(stats.categories).map(name => ({
                name,
                files: stats.categories[name].files,
                size: stats.categories[name].size,
                sizeFormatted: `${(stats.categories[name].size / 1024 / 1024).toFixed(1)} MB`
            }))
        };
        res.json(formattedStats);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Cache stats error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

async function clearCache(req, res, cache) {
    try {
        const success = await cache.clear();
        if (success) {
            res.json({ message: 'Cache cleared successfully' });
        } else {
            res.status(500).json({ error: 'Failed to clear cache' });
        }
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Cache clear error: ${error.message}`);
        res.status(500).json({ error: error.message });
    }
}

module.exports = {
    getCacheStats,
    clearCache
};