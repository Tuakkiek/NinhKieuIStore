import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_CONNECTIONSTRING || process.env.MONGO_URI;

if (!MONGODB_URI) {
  console.error("No MongoDB connection string found in .env (tried MONGODB_CONNECTIONSTRING and MONGO_URI)");
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;

    // 1. Ensure GLOBAL_ADMIN role exists in the roles collection
    const rolesColl = db.collection('roles');
    await rolesColl.updateOne(
      { key: "GLOBAL_ADMIN" },
      {
        $set: {
          key: "GLOBAL_ADMIN",
          name: "GLOBAL ADMIN",
          scopeType: "GLOBAL",
          isActive: true
        }
      },
      { upsert: true }
    );

    // 2. Create or Update the User
    const usersColl = db.collection('users');
    const hashedPassword = await bcrypt.hash("Password@123", 10);
    
    // Check if user already exists for logging purposes
    const existingUser = await usersColl.findOne({ phoneNumber: "0999999999" });

    // Ensure the array of roles aligns with the current RBAC validation in authController
    const userUpdate = {
      username: "global_admin",
      email: "admin@example.com",
      phoneNumber: "0999999999",
      password: hashedPassword,
      status: "ACTIVE",
      isActive: true,
      role: "GLOBAL_ADMIN",              // Required by prompt
      systemRoles: ["GLOBAL_ADMIN"],     // Required by prompt
      roles: ["GLOBAL_ADMIN"],           // Required to bypass `user.roles.length === 0` check
      isGlobalAdmin: true                // Required to bypass branch assignment check constraint
    };

    await usersColl.updateOne(
      { phoneNumber: "0999999999" },
      { $set: userUpdate },
      { upsert: true }
    );

    const finalUser = await usersColl.findOne({ phoneNumber: "0999999999" });

    // 3. Create or Update UserRoleAssignment
    const assignmentsColl = db.collection('userroleassignments');
    await assignmentsColl.updateOne(
      { userId: finalUser._id, roleKey: "GLOBAL_ADMIN" },
      {
        $setOnInsert: { assignedAt: new Date() },
        $set: {
          userId: finalUser._id,
          roleKey: "GLOBAL_ADMIN",
          scopeType: "GLOBAL",
          scopeRef: "",
          status: "ACTIVE"
        }
      },
      { upsert: true }
    );

    // 4. Output the result log
    console.log(JSON.stringify({
      created: !existingUser,
      userId: finalUser._id,
      phoneNumber: finalUser.phoneNumber,
      role: "GLOBAL_ADMIN",
      password: "Password@123"
    }, null, 2));

  } catch (err) {
    console.error("An error occurred during execution:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
