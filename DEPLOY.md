# 🚀 Hướng Dẫn Deploy - Ninh Kiều iStore

## 📐 Kiến trúc Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│   Frontend (React)  ──────►  Vercel                             │
│   ├── URL: https://ninhkieu-store.vercel.app                    │
│   ├── Custom Domain: canhtam.vn                                 │
│   └── API: Pings backend mỗi 5 phút để giữ backend awake       │
│                                                                  │
│   Backend (Node.js)  ──────►  Render                            │
│   ├── URL: https://ninhkieu-istore-ct.onrender.com              │
│   ├── Health: /api/ping                                        │
│   └── Custom Domain: api.ninhkieu.vn                           │
│                                                                  │
│   Database  ──────────────►  MongoDB Atlas                      │
│   ├── M0 Sandbox (Free)                                        │
│   └── Production: M10+ Cluster                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 1️⃣ Deploy Backend lên Render

### Bước 1.1: Push code lên GitHub

```bash
cd backend
git init
git add .
git commit -m "Initial backend commit"
git remote add origin https://github.com/YOUR_USERNAME/ninhkieu-istore-backend.git
git branch -M main
git push -u origin main
```

### Bước 1.2: Tạo Web Service trên Render

1. Đăng nhập [Render Dashboard](https://dashboard.render.com)
2. Click **New +** → **Web Service**
3. Connect GitHub repo `ninhkieu-istore-backend`
4. Cấu hình:

| Setting | Value |
|---------|-------|
| **Name** | `ninhkieu-istore` |
| **Region** | Singapore |
| **Branch** | `main` |
| **Root Directory** | `backend` |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node src/server.js` |
| **Instance Type** | `Free` |

### Bước 1.3: Environment Variables

Thêm các biến môi trường:

```env
NODE_ENV=production
PORT=5000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/ninhkieu
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRE=30d
REFRESH_TOKEN_EXPIRE=90d

# Firebase Admin SDK
FIREBASE_PROJECT_ID=ninhkieu-store
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@xxx.iam.gserviceaccount.com

# VNPay
VNP_TMN_CODE=YOUR_TMN_CODE
VNP_HASH_SECRET=YOUR_HASH_SECRET
VNP_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNP_RETURN_URL=https://your-domain.com/api/payment/vnpay/return

# SePay
SEPAY_API_KEY=your_sepay_api_key
SEPAY_WEBHOOK_SECRET=your_webhook_secret

# Cloudinary
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# Firebase Storage
FIREBASE_STORAGE_BUCKET=ninhkieu.appspot.com

# CORS - RATE LIMITER
CLIENT_URL=https://ninhkieu-store.vercel.app
CORS_ORIGINS=https://ninhkieu-store.vercel.app,https://ninhkieu.vn

# Email
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

### Bước 1.4: Health Check

Trong **Health Checks**, set:
```
Path: /api/ping
```

### Bước 1.5: Deploy

Click **Create Web Service** → Đợi deploy (~3-5 phút)

---

## 2️⃣ Deploy Frontend + Keep-Alive lên Vercel

### Bước 2.1: Push code lên GitHub

```bash
# Tạo repo mới cho frontend (hoặc dùng repo hiện tại)
git add .
git commit -m "Add Vercel deployment config"
git push
```

### Bước 2.2: Import lên Vercel

1. Đăng nhập [Vercel Dashboard](https://vercel.com/dashboard)
2. Click **Add New...** → **Project**
3. Import repo `ninhkieu-istore`
4. Framework: **Vite**
5. Root Directory: `.` (root)

### Bước 2.3: Cấu hình Build

```json
{
  "buildCommand": "cd frontend && npm install && npm run build",
  "outputDirectory": "frontend/dist",
  "installCommand": "npm install"
}
```

### Bước 2.4: Environment Variables

```env
VITE_API_URL=https://ninhkieu-istore.onrender.com/api
VITE_FEATURE_OMNICHANNEL_CHECKOUT=true
```

### Bước 2.5: Domain (Tùy chọn)

1. Settings → Domains
2. Thêm `api.ninhkieu.vn` → point DNS đến Render
3. Update `VITE_API_URL` = `https://api.ninhkieu.vn/api`

### Bước 2.6: Deploy

Click **Deploy** → Done!

---

## 3️⃣ Cấu hình Vercel Cron (Keep-Alive)

### Bước 3.1: File `vercel.json`

```json
{
  "version": 2,
  "buildCommand": "cd frontend && npm install && npm run build",
  "outputDirectory": "frontend/dist",
  "crons": [
    {
      "path": "/api/keep-awake",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

### Bước 3.2: Environment Variable

Trên Vercel Dashboard → Settings → Environment Variables:

```
Name: BACKEND_URL
Value: https://ninhkieu-istore.onrender.com
```

### Bước 3.3: File `api/keep-awake.js`

```javascript
/**
 * Vercel Serverless Function - Keep Backend Awake
 * Ping backend mỗi 5 phút để giữ Render không ngủ
 */

const BACKEND_URL = process.env.BACKEND_URL;

async function pingBackend() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/ping`, {
      method: 'GET',
      headers: { 'User-Agent': 'Vercel-KeepAwake/1.0' },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch (error) {
    console.error('Ping failed:', error.message);
    return false;
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getRandomDelay = () => Math.floor(Math.random() * 300000) + 180000; // 3-8 phút

export default async function handler(req, res) {
  // Ping lần 1
  const result1 = await pingBackend();

  // Delay ngẫu nhiên 3-8 phút
  await sleep(Math.min(getRandomDelay(), 270000));

  // Ping lần 2
  const result2 = await pingBackend();

  return res.json({
    success: result1 && result2,
    ping1: result1,
    ping2: result2,
    timestamp: new Date().toISOString()
  });
}
```

---

## 4️⃣ Cập nhật Frontend API URL

### Option A: Dùng Backend URL trực tiếp

```bash
# frontend/.env.production
VITE_API_URL=https://ninhkieu-istore.onrender.com/api
```

### Option B: Dùng Custom Domain

```bash
# frontend/.env.production
VITE_API_URL=https://api.ninhkieu.vn/api
```

---

## 5️⃣ Kiểm tra sau Deploy

### Test Backend

```bash
# Health check
curl https://ninhkieu-istore.onrender.com/api/health

# Ping (lightweight)
curl https://ninhkieu-istore.onrender.com/api/ping
```

### Test Frontend

```
https://ninhkieu-store.vercel.app
```

### Kiểm tra Cron Logs

Trên Vercel Dashboard → Logs → Cron Jobs

---

## 📊 Chi phí

| Service | Plan | Chi phí |
|---------|------|---------|
| Vercel Frontend | Hobby | Miễn phí |
| Vercel Cron | Hobby | Miễn phí |
| Render Backend | Free | Miễn phí (ngủ sau 15 phút) |
| MongoDB Atlas | M0 Sandbox | Miễn phí |

**Tổng: $0/tháng** (với Keep-Alive giữ backend awake)

---

## 🔧 Troubleshooting

### Backend ngủ?

1. Kiểm tra Vercel Cron logs
2. Verify `BACKEND_URL` env var
3. Test ping thủ công: `curl https://BACKEND_URL/api/ping`

### Frontend 502?

1. Kiểm tra backend đang chạy
2. Verify `VITE_API_URL` đúng
3. Check CORS settings trên Render

### Database connection failed?

1. Verify `MONGODB_URI` đúng format
2. Check IP whitelist trên MongoDB Atlas (Allow Access from Anywhere)
3. Verify Atlas password không có special characters

---

## 🔄 Redeploy

### Backend (Render)
```bash
git push origin main
# Render tự động deploy
```

### Frontend (Vercel)
```bash
git push origin main
# Vercel tự động deploy
```

Hoặc click **Redeploy** trên Dashboard.

---

## 📞 Hỗ trợ

Nếu có vấn đề, kiểm tra:
1. Render Logs → Backend errors
2. Vercel Logs → Frontend + Cron errors
3. MongoDB Atlas → Connection issues
