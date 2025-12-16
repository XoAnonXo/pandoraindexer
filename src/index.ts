/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                    PONDER EVENT HANDLERS                                   ║
 * ║                    Anymarket Prediction Markets                            ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  This file processes all blockchain events and updates the database.       ║
 * ║  Each handler corresponds to a smart contract event from the ABIs.         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * HANDLER ORGANIZATION:
 * ─────────────────────
 * 1. ORACLE HANDLERS      - Poll creation and management (src/handlers/oracle.ts)
 * 2. POLL HANDLERS        - Poll resolution events (src/handlers/poll.ts)
 * 3. FACTORY HANDLERS     - Market deployment events (src/handlers/factory.ts)
 * 4. AMM HANDLERS         - Trading and liquidity for AMM markets (src/handlers/amm.ts)
 * 5. PARIMUTUEL HANDLERS  - Betting for pool-based markets (src/handlers/parimutuel.ts)
 * 6. REFERRAL HANDLERS    - Referral code registration and tracking (src/handlers/referral.ts)
 * 7. CAMPAIGN HANDLERS    - Reward campaign creation and management (src/handlers/campaign.ts)
 * 
 * @module src/index
 */

import "./handlers/oracle";
import "./handlers/poll";
import "./handlers/factory";
import "./handlers/amm";
import "./handlers/parimutuel";
import "./handlers/referral";
import "./handlers/campaign";
