import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const addressSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true,
  },
  phoneNumber: {
    type: String,
    required: true,
    trim: true,
  },
  province: {
    type: String,
    required: true,
    trim: true,
  },
  ward: {
    type: String,
    required: true,
    trim: true,
  },
  detailAddress: {
    type: String,
    required: true,
    trim: true,
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
});

const branchAssignmentSchema = new mongoose.Schema(
  {
    storeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
      required: true,
    },
    roles: [
      {
        type: String,
        enum: [
          "BRANCH_ADMIN",
          "SALES_STAFF",
          "WAREHOUSE_MANAGER",
          "WAREHOUSE_STAFF",
          "PRODUCT_MANAGER",
          "ORDER_MANAGER",
          "POS_STAFF",
          "CASHIER",
        ],
        required: true,
      },
    ],
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED"],
      default: "ACTIVE",
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: [
        "USER",
        "CUSTOMER",
        "SALES_STAFF",
        "WAREHOUSE_MANAGER",
        "WAREHOUSE_STAFF",
        "PRODUCT_MANAGER",
        "ORDER_MANAGER",
        "SHIPPER",
        "POS_STAFF",
        "CASHIER",
        "ADMIN",
        "GLOBAL_ADMIN",
        "BRANCH_ADMIN",
      ],
      default: "USER",
      comment:
        "Deprecated legacy display field. Authorization resolves from UserRoleAssignment records.",
    },

    roles: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Role",
      },
    ],

    permissions: [
      {
        type: String,
        lowercase: true,
        trim: true,
        comment:
          "Deprecated legacy read-model field. Business logic must resolve direct grants from UserPermissionGrant.",
      },
    ],

    authzVersion: {
      type: Number,
      default: 2,
    },

    authorizationVersion: {
      type: Number,
      default: 1,
      min: 1,
    },

    systemRoles: [
      {
        type: String,
        enum: ["GLOBAL_ADMIN"],
      },
    ],

    branchAssignments: [branchAssignmentSchema],

    taskRoles: [
      {
        type: String,
        enum: ["SHIPPER"],
      },
    ],

    authzState: {
      type: String,
      enum: ["ACTIVE", "REVIEW_REQUIRED"],
      default: "ACTIVE",
    },

    permissionsVersion: {
      type: Number,
      default: 1,
      min: 1,
    },

    permissionMode: {
      type: String,
      enum: ["ROLE_FALLBACK", "EXPLICIT", "HYBRID"],
      default: "ROLE_FALLBACK",
      index: true,
      comment:
        "Deprecated legacy compatibility field. Runtime authorization no longer branches on permissionMode.",
    },

    preferences: {
      defaultBranchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Store",
      },
    },

    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: [2, "Họ tên phải có ít nhất 2 ký tự"],
      maxlength: [100, "Họ tên không được vượt quá 100 ký tự"],
    },

    phoneNumber: {
      type: String,
      required: [true, "Vui long nhap so dien thoai"],
      unique: true,
      trim: true,
      validate: {
        validator(v) {
          if (!this.isNew) return true;
          return /^0\d{9}$/.test(v);
        },
        message: "So dien thoai phai co 10 chu so va bat dau bang so 0",
      },
    },

    email: {
      type: String,
      trim: true,
      sparse: true,
      lowercase: true,
      validate: {
        validator(v) {
          if (!v) return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: "Email khong hop le. Email phai co dang: example@domain.com",
      },
    },

    /** True khi khách hàng đã xác thực email qua OTP */
    emailVerified: {
      type: Boolean,
      default: false,
    },

    emailVerifiedAt: {
      type: Date,
      default: null,
    },

    province: {
      type: String,
      trim: true,
    },

    password: {
      type: String,
      required: [true, "Vui long nhap mat khau"],
      minlength: [8, "Mat khau phai co it nhat 8 ky tu"],
      validate: {
        validator(v) {
          const hasLowerCase = /[a-z]/.test(v);
          const hasUpperCase = /[A-Z]/.test(v);
          const hasNumber = /[0-9]/.test(v);
          const hasSpecialChar = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(v);
          return hasLowerCase && hasUpperCase && hasNumber && hasSpecialChar && v.length >= 8;
        },
        message:
          "Mat khau phai co it nhat 8 ky tu, bao gom chu thuong, chu hoa, so va ky tu dac biet",
      },
    },

    status: {
      type: String,
      enum: ["ACTIVE", "LOCKED"],
      default: "ACTIVE",
    },

    addresses: [addressSchema],

    avatar: {
      type: String,
      default: null,
      trim: true,
    },

    storeLocation: {
      type: String,
      trim: true,
    },

    // Cấu hình Step-up Authentication cho từng user
    stepUpConfig: {
      // Phương thức OTP ưa thích
      preferredMethod: {
        type: String,
        enum: ["EMAIL", "SMS", "TOTP"],
        default: "EMAIL",
      },
      // TOTP secret (Google Authenticator) — chỉ select khi cần thiết
      totpSecret: {
        type: String,
        select: false,
        default: null,
      },
      // Đã bật TOTP hay chưa
      totpEnabled: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ "branchAssignments.storeId": 1 });
userSchema.index({ systemRoles: 1 });

userSchema.pre("validate", function fillLegacyFullName(next) {
  if (!this.isNew && !String(this.fullName || "").trim()) {
    const fallbackName = String(this.name || this.phoneNumber || "").trim();
    if (fallbackName) {
      this.fullName = fallbackName;
    }
  }

  next();
});

userSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  if (!this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toJSON = function toJSON() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

export default mongoose.models.User || mongoose.model("User", userSchema);
