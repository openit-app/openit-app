import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{astro,ts,tsx,html}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        ink: "hsl(var(--ink))",
        cream: "hsl(var(--cream))",
        "cream-deep": "hsl(var(--cream-deep))",
        terracotta: "hsl(var(--terracotta))",
      },
    },
  },
  plugins: [],
} satisfies Config;
