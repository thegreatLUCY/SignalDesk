/** @type {import('next').NextConfig} */
const nextConfig = {
  // Lets the dev server hot-reload reliably when source is bind-mounted from
  // the Mac into the Linux container (file-change events don't always cross
  // that boundary natively, so we poll).
  webpack: (config) => {
    config.watchOptions = { poll: 1000, aggregateTimeout: 300 };
    return config;
  },
};

export default nextConfig;
