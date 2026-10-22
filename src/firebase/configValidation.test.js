import assert from "node:assert/strict";
import test from "node:test";
import { validateFirebaseBuildEnv } from "./configValidation.js";

const validEnv = {
  VITE_FIREBASE_API_KEY: `AIza${"a".repeat(35)}`,
  VITE_FIREBASE_AUTH_DOMAIN: "rc-test.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "rc-test",
  VITE_FIREBASE_STORAGE_BUCKET: "rc-test.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "123456789",
  VITE_FIREBASE_APP_ID: "1:123456789:web:test",
};

test("accepts Firebase build configuration without optional measurementId", () => {
  assert.doesNotThrow(() => validateFirebaseBuildEnv(validEnv));
});

test("rejects every missing required Firebase variable", () => {
  for (const key of Object.keys(validEnv)) {
    const env = { ...validEnv };
    delete env[key];
    assert.throws(() => validateFirebaseBuildEnv(env), { message: new RegExp(key) });
  }
});

test("rejects empty, example and malformed Firebase keys without exposing values", () => {
  for (const value of ["", "your_api_key", "example-key", "invalid-private-value"]) {
    assert.throws(
      () => validateFirebaseBuildEnv({ ...validEnv, VITE_FIREBASE_API_KEY: value }),
      (error) => error.message.includes("VITE_FIREBASE_API_KEY") &&
        (!value || !error.message.includes(value))
    );
  }
});
