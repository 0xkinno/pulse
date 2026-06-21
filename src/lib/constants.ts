// DeepBook Predict — Testnet integration targets
// Source branch: predict-testnet-4-16
// These values are provisional per Mystenlabs docs and will change at Mainnet launch.

export const NETWORK = 'testnet' as const;

export const PREDICT_SERVER_URL = 'https://predict-server.testnet.mystenlabs.com';

export const PREDICT_PACKAGE_ID =
  '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';

export const PREDICT_REGISTRY_ID =
  '0x43af14fed5480c20ff77e2263d5f794c35b9fab7e2212903127062f4fe2a6e64';

export const PREDICT_OBJECT_ID =
  '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';

export const QUOTE_ASSET_TYPE =
  '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

export const PLP_COIN_TYPE =
  '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::plp::PLP';

export const QUOTE_ASSET_SYMBOL = 'dUSDC';

// Event types to watch for live oracle / SVI freshness on top of indexed server data
export const PREDICT_EVENT_TYPES = {
  pricesUpdated: `${PREDICT_PACKAGE_ID}::oracle::OraclePricesUpdated`,
  sviUpdated: `${PREDICT_PACKAGE_ID}::oracle::OracleSVIUpdated`,
  settled: `${PREDICT_PACKAGE_ID}::oracle::OracleSettled`,
  activated: `${PREDICT_PACKAGE_ID}::oracle::OracleActivated`,
};

export const SUI_TESTNET_RPC = 'https://fullnode.testnet.sui.io:443';

// Risk Guardian thresholds — deterministic scoring config computed entirely
// in the frontend. IMPORTANT: these do NOT mirror any actual on-chain check.
// The real Move contract (predict::mint) only checks oracle LIFECYCLE state
// via oracle_config::assert_live_oracle (active vs settled vs inactive), not
// how recently a price tick arrived. Testnet oracles can legitimately go
// quiet for hours between updates without being unsafe to trade against —
// staleness here is a soft UI signal, not a real safety boundary.
export const RISK_THRESHOLDS = {
  maxOracleStalenessSec: 3600, // beyond this, freshness score starts rising — informational, not a hard block on its own
  maxVaultUtilizationPct: 78, // mirrors max_total_exposure_pct guard rail
  butterflyArbToleranceBps: 15, // SVI convexity violation tolerance
  calendarArbToleranceBps: 10, // cross-expiry monotonicity tolerance
  minLiquidityHealthy: 0.4, // normalized 0..1 vault depth score
};