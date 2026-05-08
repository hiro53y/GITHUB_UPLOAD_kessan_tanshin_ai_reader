/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#d9ecff",
          500: "#0b6be8",
          600: "#005fe0",
          700: "#004fba",
          900: "#00235f"
        }
      },
      boxShadow: {
        soft: "0 10px 28px rgba(13, 68, 136, 0.10)"
      }
    }
  },
  plugins: []
};
