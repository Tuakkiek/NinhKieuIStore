/**
 * Vercel Serverless Function - Keep Backend Awake
 * 
 * Cron job: Mỗi 5 phút, ping backend 1-2 lần với random delay
 * để giữ Render server không bị ngủ.
 * 
 * Setup:
 * 1. Deploy repo này lên Vercel (Frontend + API)
 * 2. Thêm biến môi trường BACKEND_URL trên Vercel Dashboard
 * 3. Cron job tự động chạy mỗi 5 phút
 */

const BACKEND_URL = process.env.BACKEND_URL || "https://your-backend.onrender.com";

// Random delay: 3-8 phút (180-480 giây)
const getRandomDelayMs = () => {
  const min = 3 * 60 * 1000;  // 3 phút
  const max = 8 * 60 * 1000;  // 8 phút
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

// Ping backend một lần
async function pingBackend() {
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
      return { success: true, latency };
    } else {
      console.warn(`⚠️ Backend returned ${response.status}`);
      return { success: false, status: response.status };
    }
  } catch (error) {
    console.error(`❌ Ping failed:`, error.message);
    return { success: false, error: error.message };
  }
}

// Hàm sleep
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req, res) {
  const isCron = req.headers['x-vercel-cron'] === 'true';
  const results = [];
  
  console.log(`🔄 Vercel Cron triggered at ${new Date().toISOString()}`);
  
  // Ping lần 1
  const result1 = await pingBackend();
  results.push(result1);
  
  // Random delay 3-8 phút, nhưng không quá 4.5 phút (để còn thời gian)
  const delay = Math.min(getRandomDelayMs(), 270000); // max 4.5 phút
  console.log(`⏳ Waiting ${Math.round(delay/1000)}s before next ping...`);
  await sleep(delay);
  
  // Ping lần 2
  const result2 = await pingBackend();
  results.push(result2);
  
  const successCount = results.filter(r => r.success).length;
  
  return res.status(200).json({
    success: successCount > 0,
    message: `Pinged backend ${results.length} times, ${successCount} successful`,
    backend: BACKEND_URL,
    results,
    timestamp: new Date().toISOString(),
    nextCronIn: "5 minutes",
  });
}
