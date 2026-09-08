import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_CONNECTIONSTRING || process.env.MONGO_URI;

if (!MONGODB_URI) {
  console.error("No MongoDB connection string found in .env");
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    const usersColl = mongoose.connection.db.collection('users');

    const users = await usersColl.find({}).toArray();
    let fixedUsers = 0;
    let usersWithNoRoleBefore = 0;
    let usersUpdatedToGlobalAdmin = 0;

    for (const user of users) {
      let needsUpdate = false;
      let finalRoles = Array.isArray(user.roles) && user.roles.length > 0 ? [...user.roles] : null;
      let finalRole = user.role;
      let finalSystemRoles = Array.isArray(user.systemRoles) ? [...user.systemRoles] : null;
      let isGlobalAdmin = user.isGlobalAdmin;

      // Detect if user had no role initially
      if (!finalRoles) {
        usersWithNoRoleBefore++;
      }

      // Check for GLOBAL_ADMIN first
      const hasGlobalAdmin = 
        String(user.role).toUpperCase() === 'GLOBAL_ADMIN' || 
        (Array.isArray(user.systemRoles) && user.systemRoles.includes('GLOBAL_ADMIN')) ||
        (Array.isArray(user.roles) && user.roles.includes('GLOBAL_ADMIN')) ||
        user.isGlobalAdmin === true;

      if (hasGlobalAdmin) {
        if (!finalRoles || !finalRoles.includes('GLOBAL_ADMIN')) {
          finalRoles = ['GLOBAL_ADMIN'];
          needsUpdate = true;
          // Increment stat if we changed them from non-global or empty string
          if (!user.roles || !user.roles.includes('GLOBAL_ADMIN')) {
            usersUpdatedToGlobalAdmin++;
          }
        }
        if (finalRole !== 'GLOBAL_ADMIN') {
          finalRole = 'GLOBAL_ADMIN';
          needsUpdate = true;
        }
        if (!finalSystemRoles || !finalSystemRoles.includes('GLOBAL_ADMIN')) {
          finalSystemRoles = ['GLOBAL_ADMIN'];
          needsUpdate = true;
        }
        if (isGlobalAdmin !== true) {
          isGlobalAdmin = true;
          needsUpdate = true;
        }
      } else {
        // Normal role resolution
        if (!finalRoles) {
          if (finalSystemRoles && finalSystemRoles.length > 0) {
            finalRoles = [...finalSystemRoles];
            needsUpdate = true;
          } else if (typeof user.role === 'string' && user.role.trim() !== '') {
            finalRoles = [user.role.trim().toUpperCase()];
            needsUpdate = true;
          } else {
            finalRoles = ['CUSTOMER'];
            needsUpdate = true;
          }
        }
        
        // Ensure string `role` matches first `roles` element
        if (finalRoles.length > 0 && finalRole !== finalRoles[0]) {
          finalRole = finalRoles[0];
          needsUpdate = true;
        }
        
        // Ensure systemRoles is an array and matches roles for simplicity
        if (!finalSystemRoles || finalSystemRoles.join(',') !== finalRoles.join(',')) {
          finalSystemRoles = [...finalRoles];
          needsUpdate = true;
        }
      }

      const updateOps = { $set: {} };
      
      if (needsUpdate) {
        updateOps.$set.roles = finalRoles;
        updateOps.$set.role = finalRole;
        updateOps.$set.systemRoles = finalSystemRoles;
        if (hasGlobalAdmin) {
          updateOps.$set.isGlobalAdmin = true;
        }
      }

      // Ensure active status
      if (user.status !== "ACTIVE" || user.isActive !== true) {
        updateOps.$set.status = "ACTIVE";
        updateOps.$set.isActive = true;
        needsUpdate = true;
      }

      // Execute update if any fields changed
      if (Object.keys(updateOps.$set).length > 0) {
        await usersColl.updateOne({ _id: user._id }, updateOps);
        fixedUsers++;
      }
    }

    console.log(JSON.stringify({
      totalUsers: users.length,
      fixedUsers,
      usersWithNoRoleBefore,
      usersUpdatedToGlobalAdmin
    }, null, 2));

  } catch (err) {
    console.error("Error running fix:", err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
