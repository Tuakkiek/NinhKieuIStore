import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

/**
 * Firebase config (Client-side).
 * Lưu ý: Các keys này là public (dùng cho frontend) theo mô hình Firebase.
 * Bạn vẫn cần thiết lập Security Rules / Auth settings đúng trên Firebase Console.
 */
const firebaseConfig = {
  apiKey: "AIzaSyCgsTB3psYQn0xzVRBvY115kOVWaUvDIOQ",
  authDomain: "otp-ninhkieuistore.firebaseapp.com",
  projectId: "otp-ninhkieuistore",
  storageBucket: "otp-ninhkieuistore.firebasestorage.app",
  messagingSenderId: "641144948990",
  appId: "1:641144948990:web:7aeb7d1f168ca3fa247daf",
};

// Khởi tạo Firebase App (chỉ 1 lần)
const app = initializeApp(firebaseConfig);

// Khởi tạo Auth (dùng cho Phone Authentication)
export const auth = getAuth(app);

