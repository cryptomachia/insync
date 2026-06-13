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
  // Some workspace packages are authored with NodeNext ESM and use explicit `.js`
  // import specifiers (e.g. datastreams' `./client.js`). Map `.js` back to the TS
  // source so webpack resolves them when transpiling those packages.
  webpack: (config, { isServer, webpack }) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    };
    // The Data Streams client imports `node:crypto` for live HMAC auth — server-only,
    // never called in mock. Strip the `node:` scheme and stub the builtins on the
    // browser bundle so the client compiles (live report fetching belongs server-side).
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        }),
      );
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        crypto: false,
        stream: false,
        buffer: false,
        util: false,
      };
    }
    return config;
  },
};

export default nextConfig;
