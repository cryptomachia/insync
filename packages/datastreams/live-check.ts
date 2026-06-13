// One-off live check for Chainlink Data Streams (off-chain REST + HMAC).
// Run: MOCK=false CHAINLINK_DATASTREAMS_API_KEY=.. CHAINLINK_DATASTREAMS_API_SECRET=.. npx tsx live-check.ts
import { getReport, getTokenPriceUsd1e8, FEEDS, MOCK } from './src/index.js';

const feed = FEEDS['ETH/USD'] ?? 'ETH/USD';
console.log('MOCK =', MOCK, '| host =', process.env.DATASTREAMS_API_HOST ?? '(default)');
console.log('feed ETH/USD =', feed);

const price = await getTokenPriceUsd1e8(feed);
console.log('ETH/USD price (1e8):', price.toString(), '≈ $' + (Number(price) / 1e8).toFixed(2));

const report = await getReport(feed);
console.log('report bytes len:', report.length, '| prefix:', report.slice(0, 26), '…');
console.log(report.length > 2 ? 'LIVE DATA STREAMS OK ✓' : 'returned empty (mock?)');
