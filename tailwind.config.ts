import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Aptos", "Segoe UI", "Noto Sans SC", "sans-serif"],
        display: ["Bahnschrift", "Aptos Display", "Segoe UI", "sans-serif"],
      },
      colors: {
        ink: "#17202a",
        graphite: "#2c333a",
        paper: "#f5f7f4",
        lab: "#e8ede7",
        pine: "#0e4f47",
        cobalt: "#265b9f",
        violet: "#6356a5",
        copper: "#a45b3d",
      },
      boxShadow: {
        panel: "0 14px 40px rgba(23, 32, 42, 0.09)",
        card: "0 8px 24px rgba(23, 32, 42, 0.08)",
      },
    },
  },
  plugins: [],
} satisfies Config;
