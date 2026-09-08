# SmartMobileStore - Hệ Thống Bán Hàng Đa Chi Nhánh (Ninh Kiều iStore)

> Hệ thống thương mại điện tử bán lẻ thiết bị di động hoàn chỉnh với mô hình đa chi nhánh (omnichannel) bao gồm kênh online, POS tại cửa hàng, quản lý kho, giao hàng và quản trị.

## 📋 Mục lục

- [Tổng quan](#tổng-quan)
- [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
- [Cấu trúc dự án](#cấu-trúc-dự-án)
- [Yêu cầu hệ thống](#yêu-cầu-hệ-thống)
- [Hướng dẫn cài đặt](#hướng-dẫn-cài-đặt)
- [Chạy ứng dụng](#chạy-ứng-dụng)
- [Tính năng chính](#tính-năng-chính)
- [Vai trò người dùng](#vai-trò-người-dùng)
- [API Endpoints](#api-endpoints)
- [Quy ước phát triển](#quy-ước-phát-triển)

---

## 🎯 Tổng quan

### Mục tiêu dự án

- **Tăng khả năng bán hàng** & phục vụ khách theo mô hình đa chi nhánh
- **Đồng nhất dữ liệu vận hành** với lịch sử trạng thái đơn hàng (audit)
- **Kiểm soát rủi ro** khi vận hành nhiều chi nhánh với cơ chế phân quyền RBAC

### Công nghệ sử dụng

| Thành phần | Công nghệ |
|------------|-----------|
| **Backend** | Node.js + Express.js 5 |
| **Frontend** | React 19 + Vite + Tailwind CSS |
| **Database** | MongoDB (Mongoose) |
| **UI Components** | Radix UI, shadcn/ui |
| **State Management** | Zustand |
| **Authentication** | JWT, Firebase Auth, Email OTP |
| **Payments** | VNPay, SePay (QR Transfer), COD |
| **Media Storage** | Cloudinary, Firebase Storage |

---

## 🏗️ Kiến trúc hệ thống

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                         │
│   React Router 7 │ Zustand │ Tailwind CSS │ Radix UI           │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      BACKEND (Express.js)                      │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │   Auth   │  │  Orders  │  │Inventory │  │ Payments │       │
│  │   (JWT)  │  │   (OMS)  │  │  (Kho)   │  │ (VNPay)  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │  Stores  │  │ Warranty │  │  Device  │  │   POS    │       │
│  │(Chi nhánh)│ │ (Bảo hành)│ │ (IMEI)  │  │ (Quầy)   │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    DATABASE & SERVICES                          │
│                                                                 │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│   │  MongoDB │  │Cloudinary│  │ Firebase │  │   SMTP   │     │
│   │ (Data)   │  │ (Media)  │  │  (Auth)  │  │ (Email)  │     │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 📁 Cấu trúc dự án

```
SmartMobileStore/
├── backend/                    # Backend API (Node.js + Express)
│   ├── src/
│   │   ├── authz/             # Authorization & RBAC
│   │   ├── config/            # Cấu hình ứng dụng
│   │   ├── middleware/        # Express middlewares
│   │   ├── modules/           # Domain modules
│   │   ├── services/          # Business logic services
│   │   ├── seeders/           # Database seeders
│   │   └── tests/            # Unit tests
│   ├── public/                # Static files
│   ├── scripts/               # Migration & utility scripts
│   ├── uploads/               # Uploaded files directory
│   ├── package.json
│   └── .gitignore
│
├── frontend/                   # Frontend App (React + Vite)
│   ├── src/
│   │   ├── app/              # Bootstrap, providers, layouts, router
│   │   ├── features/         # Feature modules
│   │   │   ├── account/      # Tài khoản người dùng
│   │   │   ├── afterSales/   # Hậu mãi, bảo hành
│   │   │   ├── auth/         # Xác thực, đăng nhập
│   │   │   ├── catalog/      # Danh mục sản phẩm
│   │   │   ├── checkout/      # Thanh toán
│   │   │   ├── content/      # Nội dung (banner, video)
│   │   │   ├── devices/      # Thiết bị (IMEI/Serial)
│   │   │   ├── employees/    # Quản lý nhân viên
│   │   │   ├── inventory/    # Tồn kho
│   │   │   ├── orders/       # Quản lý đơn hàng
│   │   │   ├── promotions/   # Khuyến mãi
│   │   │   ├── reports/      # Báo cáo, thống kê
│   │   │   ├── reviews/      # Đánh giá sản phẩm
│   │   │   ├── shipping/    # Giao hàng, vận chuyển
│   │   │   ├── stores/       # Quản lý chi nhánh
│   │   │   ├── supplier/    # Nhà cung cấp
│   │   │   ├── trade-in/    # Thu cũ đổi mới
│   │   │   ├── videos/       # Video sản phẩm
│   │   │   └── warehouse/    # Kho hàng
│   │   └── shared/           # Shared utilities & UI components
│   ├── public/               # Static assets
│   ├── docs/                 # Frontend documentation
│   ├── package.json
│   └── .gitignore
│
├── docs/                      # Project documentation
│   ├── NinhKieu_iStore_System_Source_Knowledge.md
│   └── CLOUDINARY_REVIEW_MEDIA_IMPLEMENTATION_GUIDE.md
│
├── warehouse-config/           # Warehouse management module
├── package.json              # Root npm workspace config
├── PROMPT_*.md              # Development prompts (optional)
└── README.md                 # This file
```

---

## 📦 Yêu cầu hệ thống

### Phần mềm cần thiết

| Phần mềm | Phiên bản tối thiểu |
|----------|---------------------|
| Node.js | 18.x hoặc cao hơn |
| npm | 9.x hoặc cao hơn |
| MongoDB | 6.0 hoặc cao hơn |

### Các dịch vụ bên ngoài (Tùy chọn)

- **VNPay** - Cổng thanh toán trực tuyến
- **SePay** - Thanh toán chuyển khoản QR
- **Cloudinary** - Lưu trữ media (hình ảnh, video)
- **Firebase** - Xác thực người dùng, push notification
- **SMTP Server** - Gửi email OTP

---

## 🚀 Hướng dẫn cài đặt

### 1. Clone dự án

```bash
git clone https://github.com/Tuakkiek/SmartMobileStore.git
cd SmartMobileStore
```

### 2. Cài đặt dependencies

```bash
# Cài đặt tất cả dependencies (backend + frontend)
npm install

# Hoặc cài đặt riêng
cd backend && npm install
cd ../frontend && npm install
```

### 3. Cấu hình môi trường

#### Backend

Tạo file `.env` trong thư mục `backend/`:

```env
# Server
PORT=5000
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/smartmobilestore

# JWT
JWT_SECRET=your-secret-key-here
JWT_EXPIRES_IN=7d

# VNPay (tùy chọn)
VNPAY_TMN_CODE=your-tmn-code
VNPAY_HASH_SECRET=your-hash-secret
VNPAY_URL=https://sandbox.vnpayment.vn

# SePay (tùy chọn)
SEPAY_API_KEY=your-sepay-api-key
SEPAY_WEBHOOK_TOKEN=your-webhook-token

# Cloudinary (tùy chọn)
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret

# Firebase (tùy chọn)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email

# SMTP (tùy chọn)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
```

#### Frontend

Tạo file `.env` trong thư mục `frontend/`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_APP_NAME=Ninh Kiều iStore
```

### 4. Khởi tạo Database

```bash
# Chạy seeders để tạo dữ liệu mẫu
cd backend
npm run seed:permission-catalog
npm run seed:role-definitions
npm run seed:permission-groups
npm run seed:demo-authz-users
```

---

## ▶️ Chạy ứng dụng

### Development Mode

```bash
# Chạy cả backend và frontend (2 terminal)
# Terminal 1: Backend
cd backend
npm run dev

# Terminal 2: Frontend
cd frontend
npm run dev
```

### Production Build

```bash
# Build cả hai
npm run build

# Chạy production
npm run start
```

### Các lệnh npm scripts hữu ích

| Lệnh | Mô tả |
|------|-------|
| `npm run build` | Build cả backend và frontend |
| `npm run start` | Chạy backend production |
| Backend Scripts | |
| `npm run dev` | Chạy backend với nodemon |
| `npm run test` | Chạy unit tests |
| `npm run seed:*` | Chạy các seeders |
| `npm run migrate:*` | Chạy các migrations |
| `npm run phase6:all` | Test Phase 6 (VNPay, OMS) |

---

## ✨ Tính năng chính

### 🛒 E-Commerce (Khách hàng)

- [x] Đăng ký / Đăng nhập tài khoản
- [x] Tìm kiếm sản phẩm với autocomplete
- [x] Xem chi tiết sản phẩm, chọn variant
- [x] Quản lý giỏ hàng
- [x] Checkout với nhiều phương thức thanh toán
- [x] Theo dõi đơn hàng theo timeline
- [x] Tra cứu bảo hành theo IMEI/Serial/SĐT

### 🏪 POS (Point of Sale)

- [x] Tạo đơn hàng tại quầy
- [x] Quét/barcode sản phẩm
- [x] Thanh toán tiền mặt
- [x] Xuất hóa đơn VAT
- [x] Gán IMEI/Serial cho sản phẩm

### 📦 Quản lý Kho

- [x] Nhập kho (Stock In)
- [x] Xuất kho (Pick Order)
- [x] Chuyển kho giữa chi nhánh
- [x] Kiểm kê (Cycle Count)
- [x] Quản lý vị trí kho (Warehouse Locations)

### 📋 Quản lý Đơn hàng (OMS)

- [x] Xem danh sách đơn theo filter
- [x] Gán chi nhánh xử lý
- [x] Gán shipper/carrier
- [x] Cập nhật trạng thái theo state machine
- [x] Xử lý huỷ/hoàn đơn (Safe Cancel)

### 🏢 Quản lý Chi nhánh

- [x] Quản lý thông tin chi nhánh
- [x] Tồn kho theo chi nhánh
- [x] Dashboard tồn kho tổng hợp
- [x] Định tuyến đơn tự động theo khoảng cách

### 📱 Quản lý Thiết bị (IMEI/Serial)

- [x] Quản lý thiết bị theo IMEI/Serial
- [x] Gán thiết bị vào đơn hàng
- [x] Tracking tình trạng thiết bị

### 🔐 Phân quyền (RBAC)

- [x] RBAC với vai trò và quyền chi tiết
- [x] Phân quyền theo chi nhánh (Branch Context)
- [x] Step-up Authentication (OTP) cho thao tác nhạy cảm
- [x] Audit log cho mọi thao tác

---

## 👥 Vai trò người dùng

| Vai trò | Mô tả |
|---------|--------|
| **Guest** | Khách vãng lai, chỉ xem sản phẩm |
| **Customer** | Khách hàng đã đăng ký, mua hàng online |
| **POS Staff** | Nhân viên bán hàng tại quầy |
| **Cashier** | Thu ngân, xử lý thanh toán |
| **Warehouse Staff** | Nhân viên kho, nhập/xuất kho |
| **Shipper** | Nhân viên giao hàng |
| **Manager** | Quản lý chi nhánh |
| **Admin** | Quản trị viên toàn hệ thống |

---

## 🔌 API Endpoints

### Authentication

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| POST | `/api/auth/register` | Đăng ký tài khoản |
| POST | `/api/auth/login` | Đăng nhập |
| POST | `/api/auth/logout` | Đăng xuất |
| POST | `/api/auth/refresh` | Refresh token |
| POST | `/api/auth/verify-otp` | Xác thực OTP |

### Products

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/products` | Danh sách sản phẩm |
| GET | `/api/products/:slug` | Chi tiết sản phẩm |
| POST | `/api/products` | Tạo sản phẩm (Admin) |
| PUT | `/api/products/:id` | Cập nhật sản phẩm (Admin) |
| DELETE | `/api/products/:id` | Xóa sản phẩm (Admin) |

### Orders

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/orders` | Danh sách đơn hàng |
| GET | `/api/orders/:id` | Chi tiết đơn hàng |
| POST | `/api/orders` | Tạo đơn hàng |
| PUT | `/api/orders/:id/status` | Cập nhật trạng thái |
| POST | `/api/orders/:id/cancel` | Hủy đơn hàng |

### Payments

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| POST | `/api/payments/vnpay/create` | Tạo thanh toán VNPay |
| GET | `/api/payments/vnpay/return` | VNPay return callback |
| POST | `/api/payments/vnpay/ipn` | VNPay IPN callback |
| POST | `/api/payments/sepay/qr` | Tạo QR SePay |
| POST | `/api/payments/sepay/webhook` | SePay webhook |

### Inventory

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/inventory` | Tồn kho theo chi nhánh |
| POST | `/api/inventory/stock-in` | Nhập kho |
| POST | `/api/inventory/pick` | Xuất kho (pick) |
| POST | `/api/inventory/transfer` | Chuyển kho |

### Stores

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/stores` | Danh sách chi nhánh |
| GET | `/api/stores/:id` | Chi tiết chi nhánh |
| POST | `/api/stores` | Tạo chi nhánh (Admin) |
| PUT | `/api/stores/:id` | Cập nhật chi nhánh |

### Warranty

| Method | Endpoint | Mô tả |
|--------|----------|--------|
| GET | `/api/warranty/lookup` | Tra cứu bảo hành |
| GET | `/api/warranties` | Danh sách bảo hành (Admin) |
| PUT | `/api/warranties/:id` | Cập nhật bảo hành (Admin) |

---

## 📐 Quy ước phát triển

### Git Workflow

```bash
# Tạo feature branch
git checkout -b feature/your-feature-name

# Commit với conventional commits
git commit -m "feat: add new feature"
git commit -m "fix: resolve bug"
git commit -m "docs: update documentation"

# Push và tạo PR
git push origin feature/your-feature-name
```

### Code Style

- **Backend**: ESLint với Express conventions
- **Frontend**: ESLint + Prettier (React)

### Naming Conventions

| Loại | Quy ước | Ví dụ |
|------|---------|-------|
| Components | PascalCase | `ProductCard.jsx` |
| Hooks | camelCase với `use` | `useAuth.js` |
| API functions | camelCase với `api` | `productApi.js` |
| Stores (Zustand) | camelCase với `store` | `useCartStore.js` |
| Constants | UPPER_SNAKE_CASE | `ORDER_STATUS` |

### Import Rules (Frontend)

```
features/ → chỉ import từ features khác qua barrel exports
shared/ → không được import từ features
app/ → chỉ import từ shared và feature barrels
```

### Branch Isolation (Backend)

Một số model có cơ chế cô lập theo chi nhánh:
- `StoreInventory`
- `Device`
- `WarrantyRecord`
- `WarehouseLocation`
- `Inventory`

Khi thao tác với các model này, cần gửi header:
```
x-active-branch-id: <store_id>
```

---

## 📄 License

Dự án này được phát triển cho **Ninh Kiều iStore** - Cần Thơ, Việt Nam.

---

## 📞 Liên hệ

- **GitHub**: [SmartMobileStore](https://github.com/Tuakkiek/SmartMobileStore)
- **Issues**: [Bug Reports](https://github.com/Tuakkiek/SmartMobileStore/issues)

---

> **Ghi chú**: Đây là tài liệu hệ thống Ninh Kiều iStore - Hệ thống bán hàng đa chi nhánh (omnichannel) với đầy đủ tính năng E-Commerce, POS, Warehouse Management và RBAC.
