const requiredKeys = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

export function validateFirebaseBuildEnv(env) {
  const invalidKeys = requiredKeys.filter((key) => {
    const value = env[key];
    return (
      typeof value !== "string" ||
      !value.trim() ||
      /example|placeholder|your[_-]|sua[_-]|seu[_-]|xxxxx/i.test(value)
    );
  });

  if (
    !invalidKeys.includes("VITE_FIREBASE_API_KEY") &&
    !/^AIza[A-Za-z0-9_-]{35}$/.test(env.VITE_FIREBASE_API_KEY)
  ) {
    invalidKeys.push("VITE_FIREBASE_API_KEY");
  }

  if (invalidKeys.length) {
    throw new Error(
      `Firebase: configure valid build environment variables: ${invalidKeys.join(", ")}.`
    );
  }
}
