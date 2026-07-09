import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        market: {
          ink: "#07110f",
          night: "#0b1614",
          panel: "#10201d",
          panelSoft: "#142a25",
          line: "#22423b",
          mint: "#71f2a3",
          green: "#22c55e",
          amber: "#f59e0b",
          red: "#ef4444",
          blue: "#38bdf8",
        },
      },
      boxShadow: {
        touch: "0 18px 60px rgba(0, 0, 0, 0.28)",
      },
    },
  },
  plugins: [],
};

export default config;
