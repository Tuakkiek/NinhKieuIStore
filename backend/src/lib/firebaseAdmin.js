import admin from "firebase-admin";

const DEV_FALLBACK_FIREBASE_PROJECT_ID = "otp-ninhkieuistore";

const tryParseServiceAccount = () => {
  const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON (must be JSON)");
  }
};

const tryResolveProjectIdFromFirebaseConfig = () => {
  const raw = process.env.FIREBASE_CONFIG;
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return String(parsed?.projectId || parsed?.project_id || "").trim();
  } catch (error) {
    return "";
  }
};

const resolveFirebaseProjectId = (serviceAccount) =>
  String(
    serviceAccount?.project_id ||
      process.env.FIREBASE_PROJECT_ID ||
      tryResolveProjectIdFromFirebaseConfig() ||
      process.env.GCLOUD_PROJECT ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      (process.env.NODE_ENV !== "production" ? DEV_FALLBACK_FIREBASE_PROJECT_ID : ""),
  ).trim();

export const getFirebaseAdmin = () => {
  if (admin.apps.length > 0) return admin;

  const serviceAccount = tryParseServiceAccount();
  const projectId = resolveFirebaseProjectId(serviceAccount);

  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      ...(projectId ? { projectId } : {}),
    });
    return admin;
  }

  // Fallback: Google Application Default Credentials (recommended for server environments)
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
  return admin;
};

export default {
  getFirebaseAdmin,
};
