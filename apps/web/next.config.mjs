/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The workspace packages ship as untranspiled TS/TSX source, so Next must
  // compile them. SPEC §10 requires all five to be listed here.
  transpilePackages: [
    '@handoff/auth',
    '@handoff/funding',
    '@handoff/qr',
    '@handoff/datastreams',
    '@handoff/contracts-abi',
  ],
};

export default nextConfig;
