module.exports = {
  apps: [
    {
      name: "ai-advisor",
      script: ".venv/bin/uvicorn",
      args: "src.main:app --host 127.0.0.1 --port 8000",
      cwd: "/var/www/rebalancer/packages/ai-advisor",
      interpreter: "none",
      env: {
        AI_HOST: "127.0.0.1",
        AI_PORT: "8000",
        AI_LOG_LEVEL: "info",
        AI_NEXTJS_BASE_URL: "http://127.0.0.1:3001",
        AI_CHAIN_ID: "8453",
        AI_VAULT_ADDRESS: "0xf950dA9A11A3D7701470e4F37a68A5e6bC9b177C",
        AI_LLM_ENABLED: "false",
        AI_LLM_MODEL: "gpt-4o-mini",
      },
      max_memory_restart: "256M",
      restart_delay: 5000,
    },
  ],
};
