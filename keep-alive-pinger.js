/**
 * Keep-Awake Pinger - Giữ cho Render backend không bị ngủ
 * 
 * Deploy file này lên Vercel/Netlify (miễn phí) để ping backend
 * sau mỗi 3-8 phút ngẫu nhiên.
 * 
 * Cách sử dụng:
 * 1. Deploy file này lên Vercel (vercel.com) hoặc Netlify
 * 2. Thêm cron job hoặc dùng @vercel/cron để chạy tự động
 */

// Cấu hình - THAY ĐỔI URL NÀY THÀNH BACKEND CỦA BẠN
const BACKEND_URL = process.env.BACKEND_URL || "https://your-backend.onrender.com";

// Random thời gian ping: 3-8 phút (180-480 giây)
const getRandomDelay = () => {
  const min = 3 * 60 * 1000;  // 3 phút
  const max = 8 * 60 * 1000;  // 8 phút
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

const pingBackend = async () => {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${BACKEND_URL}/api/ping`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Keep-Awake-Pinger/1.0',
        'Accept': 'text/plain',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });
    
    const latency = Date.now() - startTime;
    const time = new Date().toISOString();
    
    if (response.ok) {
      console.log(`[${time}] ✅ Ping OK - Backend awake! (${latency}ms)`);
    } else {
      console.log(`[${time}] ⚠️ Ping returned ${response.status} (${latency}ms)`);
    }
  } catch (error) {
    const time = new Date().toISOString();
    console.error(`[${time}] ❌ Ping failed:`, error.message);
  }
};

// Chạy ngay lần đầu
console.log("🚀 Keep-Awake Pinger started!");
console.log(`📡 Pinging: ${BACKEND_URL}`);
console.log(`⏱️ Random interval: 3-8 minutes`);

pingBackend();

// Lặp lại với thời gian ngẫu nhiên
const scheduleNextPing = () => {
  const delay = getRandomDelay();
  const nextPingTime = new Date(Date.now() + delay).toISOString();
  
  console.log(`\n⏰ Next ping in ${Math.round(delay / 1000 / 60)} minutes at ${nextPingTime}`);
  
  setTimeout(async () => {
    await pingBackend();
    scheduleNextPing();
  }, delay);
};

scheduleNextPing();

// Export cho Vercel Serverless Functions
export default async function handler(req, res) {
  await pingBackend();
  
  res.status(200).json({
    success: true,
    message: "Ping executed",
    backend: BACKEND_URL,
    timestamp: new Date().toISOString(),
  });
}
