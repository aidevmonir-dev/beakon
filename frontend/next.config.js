/** @type {import('next').NextConfig} */
const nextConfig = {
  skipTrailingSlashRedirect: true,
  productionBrowserSourceMaps: false,
  devIndicators: { buildActivity: false },
  typescript: { ignoreBuildErrors: true },
  onDemandEntries: {
    maxInactiveAge: 60 * 1000,
    pagesBufferLength: 2,
  },
  // Hosts allowed to fetch HMR / dev resources. Required when reaching the
  // dev server from anything other than localhost — LAN IPs, Cloudflare /
  // ngrok tunnels, etc. Production builds ignore this.
  // Add additional origins via NEXT_PUBLIC_DEV_ORIGINS=host1,host2 in .env.local.
  allowedDevOrigins: [
    "192.168.56.1",                 // Hyper-V / VirtualBox host adapter
    "192.168.0.0/16",               // Common home LAN ranges
    "10.0.0.0/8",                   // Office / VPN ranges
    "*.trycloudflare.com",          // Cloudflare quick tunnels
    "*.ngrok-free.app",             // ngrok free tier (legacy .app)
    "*.ngrok-free.dev",             // ngrok free tier (current .dev)
    "*.ngrok.io",                   // ngrok legacy
    ...((process.env.NEXT_PUBLIC_DEV_ORIGINS || "")
      .split(",").map((s) => s.trim()).filter(Boolean)),
  ],
  async rewrites() {
    return [
      // Django expects a trailing slash on every route; Next.js strips it
      // before running the rewrite, so a straight "/api/:path*" destination
      // ends up as "/api/v1/auth/login" on Django and 404s. Two rules:
      // one for the (rare) explicit-slash hit, one to always append.
      {
        source: "/api/:path*/",
        destination: "http://localhost:8000/api/:path*/",
      },
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*/",
      },
    ];
  },
};

module.exports = nextConfig;
