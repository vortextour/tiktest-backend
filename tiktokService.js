// tiktokService.js - Real-time TikTok Fetcher (Optimized for Production)

// মেমরি বাঁচানোর জন্য হেল্পার ফাংশনগুলো মেইন ফাংশনের বাইরে রাখা হয়েছে
const formatCount = (num) => {
  const n = parseInt(num, 10);
  if (isNaN(n) || n <= 0) return '0';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
};

const formatDuration = (sec) => {
  const s = parseInt(sec, 10);
  if (isNaN(s) || s < 0) return "00:00";
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const r = (s % 60).toString().padStart(2, '0');
  return `${m}:${r}`;
};

const getFullUrl = (path) => {
  if (!path || typeof path !== 'string') return '';
  return path.startsWith('http') ? path : `https://www.tikwm.com${path}`;
};

// অনুমোদিত ডোমেইনের তালিকা (SSRF অ্যাটাক প্রতিরোধ করার জন্য)
const ALLOWED_DOMAINS = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
  'm.tiktok.com'
]);

// URL ভ্যালিডেশন এবং নরমালাইজেশন (Tracking parameters মুছে ফেলা)
const validateAndNormalizeURL = (rawUrl) => {
  try {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    
    const parsedUrl = new URL(rawUrl);
    
    if (!ALLOWED_DOMAINS.has(parsedUrl.hostname)) {
      return null;
    }
    
    // শুধুমাত্র origin এবং pathname রাখা হচ্ছে (যাতে ?is_copy_url=1 এর মত ট্যাগ বাদ যায়)
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch (error) {
    return null; // Malformed URL
  }
};

const extractTikTokData = async (rawUrl) => {
  const normalizedUrl = validateAndNormalizeURL(rawUrl);
  
  if (!normalizedUrl) {
    throw new Error("INVALID_URL");
  }
  
  // এনভায়রনমেন্ট ভেরিয়েবল থেকে টাইমআউট সেট করা (ডিফল্ট ৮ সেকেন্ড)
  const TIMEOUT_MS = parseInt(process.env.TIKWM_TIMEOUT, 10) || 8000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const apiUrl = `https://www.tikwm.com/api/?url=${encodeURIComponent(normalizedUrl)}&hd=1`;
    
    const response = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    
    clearTimeout(timeoutId);
    
    // HTTP 4xx এবং 5xx এরর হ্যান্ডলিং
    if (!response.ok) {
      if (response.status >= 500) throw new Error("API_UPSTREAM_ERROR");
      if (response.status >= 400) throw new Error("API_BAD_REQUEST");
    }
    
    const json = await response.json();
    
    // TikWM নির্দিষ্ট এরর হ্যান্ডলিং (প্রাইভেট, ডিলিট হওয়া বা না পাওয়া ভিডিও)
    if (json.code === -1 || !json.data) {
      const msg = (json.msg || "").toLowerCase();
      if (msg.includes("private") || msg.includes("deleted") || msg.includes("not found")) {
        throw new Error("VIDEO_UNAVAILABLE");
      }
      throw new Error("VIDEO_NOT_FOUND");
    }
    
    const data = json.data;
    
    // ডেটা স্ট্রাকচার সেফভাবে তৈরি করা (Missing properties হ্যান্ডলিং)
    return {
      title: data.title || "TikTok Video",
      thumbnail: getFullUrl(data.cover),
      duration: formatDuration(data.duration),
      creator: {
        username: `@${data.author?.unique_id || data.author?.nickname || 'creator'}`,
        avatar: getFullUrl(data.author?.avatar),
        publishedAt: "Recently" // TikWM API সরাসরি published date দেয় না
      },
      stats: {
        views: `${formatCount(data.play_count)} Views`,
        likes: `${formatCount(data.digg_count)} Likes`,
        resolution: "1080x1920" // Default fallback
      },
      downloads: {
        hd: { url: getFullUrl(data.hdplay || data.play), size: "HD Quality" },
        standard: { url: getFullUrl(data.play), size: "SD Quality" },
        watermark: { url: getFullUrl(data.wmplay || data.play), size: "Watermark" }
      }
    };
    
  } catch (error) {
    clearTimeout(timeoutId);
    
    // লগিং সিকিউর রাখা (শুধু আসল এরর মেসেজ, সম্পূর্ণ স্ট্যাক ট্রেস নয়)
    const isKnownError = ["INVALID_URL", "VIDEO_NOT_FOUND", "VIDEO_UNAVAILABLE", "API_UPSTREAM_ERROR", "API_BAD_REQUEST"].includes(error.message);
    
    if (error.name === 'AbortError') {
      console.error("🔥 TikWM API Timeout");
      throw new Error("API_TIMEOUT");
    }
    
    if (!isKnownError) {
      console.error("🔥 TikTok Fetch Error:", error.message);
      throw new Error("API_INTERNAL_ERROR");
    }
    
    throw error;
  }
};

module.exports = { extractTikTokData, validateAndNormalizeURL };