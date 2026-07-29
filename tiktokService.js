// tiktokService.js - Real-time TikTok Fetcher

const extractTikTokData = async (url) => {
    if (!url || !url.includes('tiktok.com')) {
        throw new Error("INVALID_URL");
    }

    try {
        // TikWM Public API endpoint to get real TikTok videos without watermark
        const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`;
        const response = await fetch(apiUrl);
        const json = await response.json();

        // Check if TikTok video was found
        if (json.code !== 0 || !json.data) {
            throw new Error("VIDEO_NOT_FOUND");
        }

        const data = json.data;

        // Helper to format views/likes count (e.g. 1200000 -> 1.2M)
        const formatCount = (num) => {
            if (!num) return '0';
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
            return num.toString();
        };

        // Helper to format duration seconds (e.g. 45 -> 00:45)
        const formatDuration = (sec) => {
            if (!sec) return "00:30";
            const m = Math.floor(sec / 60).toString().padStart(2, '0');
            const s = (sec % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        const domain = "https://www.tikwm.com";
        const getFullUrl = (path) => {
            if (!path) return '';
            return path.startsWith('http') ? path : `${domain}${path}`;
        };

        // Format real TikTok data for Frontend
        return {
            title: data.title || "TikTok Video",
            thumbnail: getFullUrl(data.cover),
            duration: formatDuration(data.duration),
            creator: {
                username: `@${data.author?.unique_id || data.author?.nickname || 'creator'}`,
                avatar: getFullUrl(data.author?.avatar),
                publishedAt: "Recently"
            },
            stats: {
                views: `${formatCount(data.play_count)} Views`,
                likes: `${formatCount(data.digg_count)} Likes`,
                resolution: "1080x1920"
            },
            downloads: {
                hd: { url: getFullUrl(data.hdplay || data.play), size: "HD Quality" },
                standard: { url: getFullUrl(data.play), size: "SD Quality" },
                watermark: { url: getFullUrl(data.wmplay || data.play), size: "Watermark" }
            }
        };
    } catch (error) {
        console.error("TikTok Fetch Error:", error.message);
        if (error.message === "INVALID_URL" || error.message === "VIDEO_NOT_FOUND") {
            throw error;
        }
        throw new Error("API_TIMEOUT");
    }
};

module.exports = { extractTikTokData };
