/**
 * Vercel Serverless Function - Keep Backend Awake
 * 
 * Tự động ping backend mỗi 5 phút để giữ Render server không ngủ.
 * 
 * Setup:
 * 1. Deploy repo này lên Vercel
 * 2. Thêm biến môi trường BACKEND_URL trên Vercel Dashboard
 * 3. Cron job đã được cấu hình trong vercel.json
 */

const BACKEND_URL = process.env.BACKEND_URL || "https://your-backend.onrender.com";

// Random thời gian: 3-8 phút
const getRandomDelay = () => {
  const min = 3 * 60 * 1000;
  const max = 8 * 60 * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export default async function handler(req, res) {
  // Chỉ cho phép cron job gọi (hoặc manual test)
  if (req.headers['x-vercel-cron']) {
    console.log("🔄 Vercel Cron triggered");
  }

  const startTime = Date.now();
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/ping`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Vercel-KeepAwake/1.0',
        'Accept': 'text/plain',
      },
      signal: AbortSignal.timeout(10000),
    });
    
    const latency = Date.now() - startTime;
    
    if (response.ok) {
      console.log(`✅ Backend awake! (${latency}ms)`);
      
      return res.status(200).json({
        success: true,
        message: "Backend pinged successfully",
        backend: BACKEND_URL,
        latency: `${latency}ms`,
        timestamp: new Date().toISOString(),
        nextPingIn: `${Math.round(getRandomDelay() / 1000 / 60)} minutes`,
      });
    } else {
      console.warn(`⚠️ Backend returned ${response.status}`);
      
      return res.status(response.status).json({
        success: false,
        message: `Backend returned ${response.status}`,
        backend: BACKEND_URL,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error(`❌ Ping failed:`, error.message);
    
    return res.status(500).json({
      success: false,
      message: "Ping failed",
      error: error.message,
      backend: BACKEND_URL,
      timestamp: new Date().toISOString(),
    });
  }
}
