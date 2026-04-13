import test, { before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

import authRoutes from "../modules/auth/authRoutes.js";
import User from "../modules/auth/User.js";
import { ensurePermissionTemplatesSeeded } from "../authz/permissionTemplateService.js";

let mongoServer;
let app;
let phoneSeed = 410000000;

const nextPhone = () => `0${String(phoneSeed++).padStart(9, "0")}`;

before(
  async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri(), {
      dbName: "auth-register-fullname-test",
    });

    app = express();
    app.use(express.json());
    app.use("/api/auth", authRoutes);
  },
  { timeout: 120000 },
);

beforeEach(async () => {
  const collections = Object.values(mongoose.connection.collections);
  for (const collection of collections) {
    await collection.deleteMany({});
  }

  await ensurePermissionTemplatesSeeded();
});

after(
  async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  },
  { timeout: 120000 },
);

test("POST /api/auth/register accepts fullName and phone payload", async () => {
  const phoneNumber = nextPhone();
  const payload = {
    fullName: "Nguyễn Văn A",
    phone: phoneNumber,
    email: `user.${phoneNumber}@example.com`,
    password: "Strong@1234",
  };

  const registerResponse = await request(app).post("/api/auth/register").send(payload);

  assert.equal(registerResponse.status, 201);
  assert.equal(registerResponse.body?.success, true);
  assert.equal(registerResponse.body?.data?.user?.fullName, payload.fullName);
  assert.equal(registerResponse.body?.data?.user?.phoneNumber, phoneNumber);
  assert.equal(registerResponse.body?.data?.user?.password, undefined);

  const savedUser = await User.findOne({ phoneNumber }).lean();
  assert.ok(savedUser);
  assert.equal(savedUser.fullName, payload.fullName);

  const loginResponse = await request(app)
    .post("/api/auth/login")
    .send({
      phone: phoneNumber,
      password: payload.password,
    });

  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.body?.success, true);
  assert.equal(loginResponse.body?.data?.user?.fullName, payload.fullName);
  assert.equal(loginResponse.body?.data?.user?.phoneNumber, phoneNumber);
  assert.equal(loginResponse.body?.data?.user?.password, undefined);
});

test("POST /api/auth/register rejects missing fullName", async () => {
  const phoneNumber = nextPhone();

  const response = await request(app).post("/api/auth/register").send({
    phone: phoneNumber,
    email: `missing.fullname.${phoneNumber}@example.com`,
    password: "Strong@1234",
  });

  assert.equal(response.status, 400);
  assert.equal(response.body?.success, false);
  assert.match(String(response.body?.message || ""), /họ và tên|thông tin bắt buộc/i);
});
