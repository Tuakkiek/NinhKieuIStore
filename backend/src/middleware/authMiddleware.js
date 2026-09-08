import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import User from "../modules/auth/User.js";
import config from "../config/config.js";

dotenv.config();

export const protect = async (req, res, next) => {
  try {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
      token = req.headers.authorization.split(" ")[1];
    } else if (req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        code: "AUTHN_MISSING_TOKEN",
        message: "Vui lòng đăng nhập để truy cập",
      });
    }

    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        code: "AUTHN_USER_NOT_FOUND",
        message: "Người dùng không tồn tại",
      });
    }

    if (user.status === "LOCKED") {
      return res.status(403).json({
        success: false,
        code: "AUTHN_LOCKED",
        message: "Tài khoản đã bị khóa",
      });
    }

    const tokenPermissionsVersion = Number(decoded?.pv || 1);
    const userPermissionsVersion = Number(user.permissionsVersion || 1);
    if (tokenPermissionsVersion !== userPermissionsVersion) {
      return res.status(401).json({
        success: false,
        code: "AUTHN_TOKEN_OUTDATED",
        message: "Token đã hết hạn do thay đổi quyền truy cập",
      });
    }

    req.user = user;
    req.auth = {
      userId: String(user._id),
      tokenPermissionsVersion,
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      code: "AUTHN_INVALID_TOKEN",
      message: "Token không hợp lệ hoặc đã hết hạn",
    });
  }
};

export const restrictTo = () => {
  return (_req, res) =>
    res.status(500).json({
      success: false,
      code: "AUTHZ_ROLE_GUARD_REMOVED",
      message: "Legacy role-based authorization middleware has been removed. Use permission-based authorize() instead.",
    });
};

export const signToken = (id, permissionsVersion = 1) => {
  return jwt.sign({ id, pv: Number(permissionsVersion || 1) }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  });
};
