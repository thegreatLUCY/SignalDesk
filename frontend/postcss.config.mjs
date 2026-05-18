// Tailwind v4 plugs into the build as a PostCSS plugin. That's the entire
// Tailwind setup now — no tailwind.config.js needed for the basics.
const config = {
  plugins: { "@tailwindcss/postcss": {} },
};

export default config;
