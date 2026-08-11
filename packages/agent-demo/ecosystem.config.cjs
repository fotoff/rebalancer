/**
 * pm2 config for the reference agent.
 *
 * Two apps on purpose. `agent-dry` watches and reports without ever
 * broadcasting; `agent-live` trades for real. Starting the wrong one should
 * take a deliberate act, not a forgotten flag.
 *
 *   pm2 start ecosystem.config.cjs --only agent-dry     # safe: no transactions
 *   pm2 start ecosystem.config.cjs --only agent-live    # REAL trades
 *   pm2 logs agent-dry
 */
module.exports = {
  apps: [
    {
      name: "agent-dry",
      script: "agent.mjs",
      cwd: __dirname,
      args: "",
      autorestart: true,
      // The agent already loops internally; a crash loop would mean a real
      // fault, so back off rather than hammering the RPC.
      restart_delay: 30000,
      max_restarts: 10,
      time: true,
    },
    {
      name: "agent-live",
      script: "agent.mjs",
      cwd: __dirname,
      args: "--execute",
      autorestart: true,
      restart_delay: 30000,
      max_restarts: 10,
      time: true,
    },
  ],
};
