import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    {
      name: "rc-safe-demo-entry",
      apply: "serve",
      configureServer(server) {
        if (server.config.mode === "readonly") return;

        server.middlewares.use((request, response, next) => {
          if (request.url === "/") {
            request.url = "/preview.html";
          }

          next();
        });
      },
    },

    VitePWA({
      registerType: "autoUpdate",

      includeAssets: [
        "favicon.ico",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
      ],

      manifest: {
        name: "RC Manager",
        short_name: "RC Manager",
        description: "Gestão inteligente da RC Confecções",

        theme_color: "#1e293b",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait",

        start_url: "/",
        scope: "/",

        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },

      workbox: {
        navigateFallback: "/index.html",
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,

        runtimeCaching: [
          {
            urlPattern: /^https:\/\/firestore\.googleapis\.com\/.*/i,

            handler: "NetworkFirst",

            options: {
              cacheName: "firebase-firestore",
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
});