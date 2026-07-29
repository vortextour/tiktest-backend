// This service simulates extracting data from TikTok via an external API provider.
const extractTikTokData = async (url) => {
  // 1. URL Validation Regex
  const tiktokRegex = /https:\/\/(www\.|vt\.|vm\.)?tiktok\.com\/.*$/;
  if (!tiktokRegex.test(url)) {
    throw new Error("INVALID_URL");
  }
  
  try {
    // TODO: Replace this mock with actual Axios call to RapidAPI / TikAPI
    // const response = await axios.get(`https://tiktok-api-provider.com/video?url=${url}&key=${process.env.TIKTOK_API_KEY}`);
    
    // Mock API Response perfectly tailored for our Frontend Result Section
    return {
      title: "Check out this amazing transition tutorial! Make sure to like and follow for more. #viral #trending #fyp",
      thumbnail: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?auto=format&fit=crop&w=500&q=80",
      duration: "00:45",
      creator: {
        username: "@awesome_creator",
        avatar: "https://i.pravatar.cc/150?img=32",
        publishedAt: "2 days ago"
      },
      stats: {
        views: "1.2M",
        likes: "345K",
        resolution: "1080x1920"
      },
      downloads: {
        hd: { url: "https://mock-download.com/video-hd.mp4", size: "12.5 MB" },
        standard: { url: "https://mock-download.com/video-sd.mp4", size: "4.2 MB" },
        watermark: { url: "https://mock-download.com/video-watermark.mp4", size: "14.1 MB" }
      }
    };
  } catch (error) {
    // Handle specific errors
    if (error.response?.status === 404) throw new Error("VIDEO_NOT_FOUND");
    if (error.response?.status === 403) throw new Error("PRIVATE_VIDEO");
    throw new Error("API_TIMEOUT");
  }
};

module.exports = { extractTikTokData };