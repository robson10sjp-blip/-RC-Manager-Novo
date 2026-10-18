import { getStore } from "@netlify/blobs";
import { createCertificateProvider } from "../ai/auth.js";
import { handleSecretaryRequest } from "../ai/handler.js";
import { createMemoryStore } from "../ai/rateLimit.js";

const getCertificates = createCertificateProvider();
const memoryStore = createMemoryStore();

// Em produção o contador fica em Netlify Blobs; a memória só vale no desenvolvimento local.
function resolveStore() {
  if (process.env.NETLIFY_DEV === "true" || process.env.CONTEXT === "dev") {
    return memoryStore;
  }
  try {
    const blobs = getStore("secretary-ai-usage");
    return {
      async get(key) {
        return blobs.get(key);
      },
      async set(key, value) {
        await blobs.set(key, String(value));
      },
    };
  } catch {
    return null;
  }
}

export default async (request) =>
  handleSecretaryRequest(request, {
    env: process.env,
    fetchImpl: fetch,
    store: resolveStore(),
    getCertificates,
  });

export const config = {};
