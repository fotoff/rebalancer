# Rebalancer — Архитектура

## Версия

| | |
|---|---|
| **Текущая версия** | `v2.0.0-beta.4` (closed beta) |
| **Дата** | 2026-02-17 |
| **Сеть** | Base Mainnet |
| **Домен** | [tokenrebalancer.com](https://tokenrebalancer.com) |
| **Vault V2** | `0x3310c9504a7f74d892FB7a527f417d4d46aD78a0` |

### История версий

| Версия | Дата | Описание |
|--------|------|----------|
| v1.0.0-alpha | 2026-02-08 | Первый деплой. Vault V1 + Aerodrome Router, Gelato для автоматизации |
| v1.1.0-alpha | 2026-02-08 | Замена Gelato на self-hosted trigger-checker (pm2) |
| v2.0.0-beta.1 | 2026-02-09 | **Vault V2** — generic swap через LI.FI (DEX-агрегатор). Новый контракт, интеграция с SushiSwap и другими DEX через LI.FI API. Vault-балансы в портфеле и карточках пар. История триггеров с TX-ссылками. Статистика ребалансировок |
| v2.0.0-beta.2 | 2026-02-10 | Код-ревью + оптимизация производительности. RPC fallback + multicall batching, staleTime на запросах, code splitting, мемоизация, useTokenInfo hook |
| v2.0.0-beta.3 | 2026-02-10 | Безопасность + архитектура. SQLite вместо JSON, API auth/authz, rate limiting, input validation, structured logging, health check, env validation |
| v2.0.0-beta.4 | 2026-02-11 | Смарт-контракт V3. Whitelist swapTarget, ReentrancyGuard, Pausable, partial fills, per-user pause, fee-on-transfer, 0.15% swap fee, ETH recovery. 47 тестов. Деплой + верификация BaseScan |

---

## Обзор

Сервис автоматической ребалансировки токенов в сети Base. Пользователь создаёт пары токенов, настраивает триггеры по цене/ratio, депозитит токены в vault — и система автоматически выполняет свопы при достижении условий.

**Модель:** Custodial vault — токены хранятся в смарт-контракте, свопы выполняются через executor-бота.

**DEX-агрегатор:** LI.FI — автоматически находит лучший маршрут через SushiSwap, Uniswap, Aerodrome и другие DEX.

---

## Высокоуровневая схема

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ФРОНТЕНД (Next.js 15)                       │
│  RainbowKit + Wagmi + viem + TanStack Query + Tailwind CSS         │
├─────────────────────────────────────────────────────────────────────┤
│  • Подключение кошелька (RainbowKit)                               │
│  • Портфель Base (кошелёк + vault-балансы)                         │
│  • Мои пары — карточки с ценами, балансами, триггерами             │
│  • Триггеры — создание, переключение направления, история          │
│  • Vault — deposit / withdraw                                      │
│  • Ручная ребалансировка через LI.FI                               │
│  • Статистика ребалансировок (on-chain события)                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     API (Next.js API Routes)                        │
├─────────────────────────────────────────────────────────────────────┤
│  /api/pairs           — CRUD пар (SQLite)                          │
│  /api/triggers        — CRUD триггеров (SQLite)                    │
│  /api/portfolio/scan  — сканирование токенов (Alchemy)             │
│  /api/prices          — цены (DexScreener + CoinGecko)             │
│  /api/token-meta      — метаданные (лого, изменения цен)           │
│  /api/swap/quote      — котировки LI.FI                            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
┌──────────────────────────┐  ┌────────────────┐  ┌─────────────────────────┐
│   Trigger Checker (pm2)  │  │  AI Advisor    │  │ RebalancerVault V2      │
│   Node.js / viem         │  │  Python/FastAPI│  │ Solidity 0.8.24         │
├──────────────────────────┤  ├────────────────┤  ├─────────────────────────┤
│ • Каждые 5 мин проверяет │  │ • Signals      │  │ balances[user][token]   │
│   активные триггеры      │  │ • Policy       │  │ deposit / withdraw      │
│ • Цены из DexScreener    │  │ • LLM explain  │  │ executeRebalance        │
│ • Котировки из LI.FI API │  │ • Recommend    │  │ setExecutor ← onlyOwner │
│ • Отправляет TX через    │  │ • Suggest      │  └────────────┬────────────┘
│   executor-кошелёк       │  │   triggers     │               │
│ • Помечает триггер как   │  └────────────────┘               ▼
│   сработавший            │               ┌──────────────────────────┐
└──────────────────────────┘               │  LI.FI Diamond → DEXes   │
                                           │  SushiSwap, Uniswap,     │
                                           │  Aerodrome, etc.          │
                                           └──────────────────────────┘
```

---

## Компоненты

### 1. Фронтенд (packages/web)

| Технология | Версия | Назначение |
|------------|--------|------------|
| Next.js | 15.5.12 | React-фреймворк, SSR + API Routes |
| RainbowKit | 2.x | Подключение кошельков |
| Wagmi | 2.x | React-хуки для Ethereum |
| viem | 2.45.1 | Работа с блокчейном |
| TanStack Query | 5.x | Кэш и запросы |
| Tailwind CSS | 4.x | Стили |

**Единый источник vault-балансов:**
- `VaultBalancesProvider` + хук `useVaultBalances(tokenAddresses)` — один контекст на странице, один `useReadContracts` для всех vault-балансов; все компоненты получают одинаковые данные из одного кэша (см. `hooks/use-vault-balances.tsx`).

**Ключевые компоненты:**

| Компонент | Файл | Описание |
|-----------|------|----------|
| PortfolioList | `portfolio/portfolio-list.tsx` | Таблица токенов (кошелёк + vault), данные vault через useVaultBalances |
| SavedPairs | `pairs/saved-pairs.tsx` | Карточки пар с ценами, балансами, триггерами; vault через useVaultBalances |
| PairDashboard | `rebalance/pair-dashboard.tsx` | Детальный вид пары, карточки с кошелёк/vault, useVaultBalances |
| TriggerForm | `rebalance/trigger-form.tsx` | Триггеры: «По цене токена» / «По ratio» (по умолчанию — по цене), история, статистика |
| VaultPanel | `rebalance/vault-panel.tsx` | Deposit / Withdraw; vault-балансы из parent (pair-dashboard) |
| ManualRebalance | `rebalance/manual-rebalance.tsx` | Ручной свап через LI.FI, проверка баланса кошелька vs vault |
| DirectionToggle | `rebalance/direction-toggle.tsx` | Переключение направления свапа |

### 2. API (packages/web/src/app/api)

Данные хранятся в SQLite (`data/rebalancer.db`) через `better-sqlite3` (WAL mode, busy_timeout 5s).  
Таблицы: `pairs`, `triggers`, `vault_history`, `token_scam_cache` (кэш GoPlus для скрытия scam-токенов).

| Эндпоинт | Метод | Описание |
|----------|-------|----------|
| /api/pairs | GET, POST, DELETE | CRUD пар токенов |
| /api/triggers | GET, POST, PATCH, DELETE | CRUD триггеров, обновление статуса |
| /api/portfolio/scan | GET | Сканирование токенов кошелька (Alchemy + GoPlus scam cache) |
| /api/prices | GET | Цены из DexScreener + CoinGecko |
| /api/token-meta | GET | Логотипы, изменения цен |
| /api/swap/quote | GET | Котировка LI.FI для ручного свапа |
| /api/tokens/search | GET | Поиск токенов по имени/адресу |

### 3. Trigger Checker (packages/trigger-checker)

Самостоятельный Node.js-скрипт (`checker.mjs`), запускается через pm2.

| Параметр | Значение |
|----------|----------|
| Интервал проверки | 5 минут |
| Источник цен | DexScreener API |
| Котировки свапов | LI.FI API |
| RPC | Alchemy (Base Mainnet) |
| Executor | `0x66eE7dc2FF768c253C5CeDAa86dfeAea31f47714` |

**Логика:**
1. Получить активные триггеры (`GET /api/triggers?autoEnabled=true`)
2. Получить текущие цены из DexScreener
3. Проверить условия (gte / lte / eq)
4. Если сработал — получить котировку LI.FI
5. Вызвать `executeRebalance` на vault
6. Пометить триггер как `triggered`, отключить `autoEnabled`, сохранить `txHash`

### 4. Смарт-контракт RebalancerVault V2

| Параметр | Значение |
|----------|----------|
| Сеть | Base Mainnet |
| Адрес | `0x3310c9504a7f74d892FB7a527f417d4d46aD78a0` |
| Solidity | 0.8.24 |
| Зависимости | OpenZeppelin (Ownable, SafeERC20) |
| Owner | `0xcc52f72c0813e1ada3e4acacd57d7ffeca3620ec` |
| Executor | `0x66eE7dc2FF768c253C5CeDAa86dfeAea31f47714` |

**Функции:**
- `deposit(token, amount)` — пользователь вносит токены
- `withdraw(token, amount)` — пользователь выводит свои токены
- `executeRebalance(user, fromToken, toToken, amount, swapTarget, swapCalldata, amountOutMin)` — только executor
- `setExecutor(address)` — только owner

**executeRebalance:**
1. Списать `amount` с `balances[user][fromToken]`
2. Approve `swapTarget` (LI.FI Diamond)
3. Выполнить `swapTarget.call(swapCalldata)`
4. Проверить slippage (`amountOut >= amountOutMin`)
5. Зачислить на `balances[user][toToken]`
6. Сбросить approval

---

## Безопасность

### Модель двух кошельков

| Роль | Адрес | Права | Хранение ключа |
|------|-------|-------|----------------|
| **Owner** | `0xcc52f7…` | setExecutor, deploy | Локально у владельца |
| **Executor** | `0x66eE7d…` | executeRebalance | Сервер (`ecosystem.config.cjs`, chmod 600) |

### Текущие меры

- `onlyExecutor` модификатор на `executeRebalance`
- SSH: только ключевая аутентификация, whitelist IP
- UFW файрвол: порты 22 (whitelist), 80, 443
- `npm install --ignore-scripts` — защита от postinstall-малвари
- Executor с минимальным ETH-балансом

### Известные риски и TODO

| Риск | Статус | Решение |
|------|--------|---------|
| `swapTarget` может быть любой адрес | ⚠ открыт | Добавить whitelist swapTarget |
| API без полной аутентификации (SIWE) | ⚠ частично закрыт | Добавить Sign-In with Ethereum |
| Нет бэкапов данных | ⚠ открыт | Настроить бэкапы |
| Контракт не аудирован | ⚠ открыт | Slither/Mythril + профессиональный аудит |
| Executor ключ в открытом виде | частично | chmod 600, рассмотреть KMS |

---

## Инфраструктура

| Компонент | Описание |
|-----------|----------|
| **Сервер** | VDS (91.201.114.128), Ubuntu 24.04 |
| **Домен** | tokenrebalancer.com (Cloudflare) |
| **SSL** | Cloudflare Origin Certificate |
| **Reverse proxy** | Nginx → localhost:3001 |
| **Process manager** | pm2 (rebalancer-web + trigger-checker) |
| **RPC** | Alchemy (Base Mainnet) |
| **Цены** | DexScreener API + CoinGecko (fallback) |
| **Свопы** | LI.FI API → SushiSwap, Uniswap, Aerodrome |

---

## Структура проекта

```
rebalancer/
├── ARCHITECTURE.md              # Этот файл
├── SERVER_ACCESS.md             # Доступы к серверу
├── packages/
│   ├── web/                     # Next.js 15 (фронт + API)
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx            # Главная страница
│   │   │   │   ├── layout.tsx
│   │   │   │   └── api/
│   │   │   │       ├── pairs/route.ts
│   │   │   │       ├── triggers/route.ts
│   │   │   │       ├── prices/route.ts
│   │   │   │       ├── portfolio/scan/route.ts
│   │   │   │       ├── token-meta/route.ts
│   │   │   │       ├── tokens/search/route.ts
│   │   │   │       └── swap/quote/route.ts
│   │   │   ├── components/
│   │   │   │   ├── header.tsx
│   │   │   │   ├── providers.tsx
│   │   │   │   ├── portfolio/
│   │   │   │   │   └── portfolio-list.tsx
│   │   │   │   ├── pairs/
│   │   │   │   │   ├── saved-pairs.tsx
│   │   │   │   │   ├── pair-creator.tsx
│   │   │   │   │   └── token-selector.tsx
│   │   │   │   └── rebalance/
│   │   │   │       ├── pair-dashboard.tsx
│   │   │   │       ├── trigger-form.tsx
│   │   │   │       ├── vault-panel.tsx
│   │   │   │       ├── manual-rebalance.tsx
│   │   │   │       ├── direction-toggle.tsx
│   │   │   │       └── price-chart.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── use-portfolio-tokens.ts
│   │   │   │   ├── use-token-prices.ts
│   │   │   │   └── use-token-meta.ts
│   │   │   └── lib/
│   │   │       ├── constants.ts
│   │   │       ├── tokens.ts
│   │   │       ├── vault-abi.ts
│   │   │       └── wagmi.ts
│   │   ├── data/                # Хранилище (SQLite)
│   │   │   └── rebalancer.db
│   │   └── package.json
│   │
│   ├── ai-advisor/              # AI Advisor (Python/FastAPI)
│   │   ├── src/
│   │   │   ├── main.py                # FastAPI app
│   │   │   ├── config.py             # Settings
│   │   │   ├── auth.py               # HMAC auth
│   │   │   ├── pipeline.py           # Main recommendation pipeline
│   │   │   ├── adapters/             # Data adapters (DexScreener, LI.FI, portfolio)
│   │   │   ├── features/             # Feature engineering (zscore, vol, momentum)
│   │   │   ├── signals/              # Signal engine (regime, sizing, triggers)
│   │   │   ├── policy/               # Guardrails (9 rules)
│   │   │   ├── llm/                  # LLM explanations (OpenAI + fallback)
│   │   │   ├── output/               # Recommendation builder
│   │   │   ├── models/               # Pydantic models
│   │   │   └── routers/              # API endpoints
│   │   ├── tests/                    # pytest tests
│   │   ├── requirements.txt
│   │   └── ecosystem.config.cjs      # pm2 config
│   │
│   ├── trigger-checker/         # Self-hosted бот (pm2)
│   │   ├── checker.mjs
│   │   ├── ecosystem.config.cjs
│   │   └── package.json
│   │
│   └── contracts/               # Solidity (Hardhat)
│       ├── contracts/
│       │   └── RebalancerVault.sol
│       ├── scripts/
│       │   ├── deploy.ts
│       │   └── set-executor-self.ts
│       ├── hardhat.config.ts
│       └── package.json
│
└── package.json                 # Monorepo root
```

---

## Roadmap

### Выполнено (v2.0 beta)
- [x] Фронтенд: RainbowKit, портфель, пары, ручная ребалансировка
- [x] Vault V1 → V2 (generic swap через LI.FI)
- [x] Self-hosted trigger-checker (замена Gelato)
- [x] Интеграция LI.FI (SushiSwap, Uniswap и др.)
- [x] Vault-балансы в портфеле и карточках пар
- [x] История триггеров с TX-ссылками на BaseScan
- [x] Статистика ребалансировок (on-chain события)
- [x] Деплой на сервер (Nginx + pm2 + Cloudflare)

### Выполнено (v2.0 beta.4 — аудит)
- [x] Whitelist `swapTarget` в контракте (SC1)
- [x] Комиссия 0.15% из свопа для покрытия газа
- [x] ReentrancyGuard, Pausable, per-user pause (SC3/SC6/SC8)
- [x] Приватный ключ вынесен из /var/www/ в /root/ (chmod 600)
- [x] Порт 3001 закрыт в UFW (доступ только через nginx)
- [x] Security headers в Nginx (HSTS, X-Frame-Options и др.)
- [x] POST /api/vault/history (rebalance) требует API key

### Бэклог (аудит — при следующем редеплое контракта)
- [ ] Переопределить `renounceOwnership()` → revert (защита от случайной потери owner)
- [ ] Добавить `rescueERC20()` для извлечения случайно отправленных токенов
- [ ] Timelock на критические admin-функции (setExecutor, setFeeRate, transferOwnership)

### Выполнено (AI Advisor — MVP)
- [x] AI Advisor сервис (Python/FastAPI) — сигналы, policy, LLM-объяснения
- [x] Feature engineering: zscore, volatility, momentum, correlation, cost
- [x] Signal engine: MEAN_REVERSION / TREND / NEUTRAL → HOLD / REBALANCE_NOW / SUGGEST_TRIGGERS
- [x] Policy engine: 9 guardrail правил (slippage, gas, edge, cooldown и др.)
- [x] LLM Layer: OpenAI gpt-4o-mini для объяснений + fallback шаблоны
- [x] Интеграция: Next.js proxy routes + HMAC auth + SQLite хранение
- [x] UI: карточка AI Advisor в pair-dashboard, создание триггеров по рекомендации
- [x] Тесты: features, signals, policy, output, API

### Планируется
- [ ] AI Advisor: ML модель pWin (Этап 2)
- [ ] AI Advisor: Social snapshot (Этап 3)
- [ ] SIWE аутентификация (Sign-In with Ethereum) — защита API от чтения чужих данных
- [ ] Бэкапы данных (SQLite)
- [ ] Slither/Mythril анализ контракта
- [ ] Telegram уведомления о срабатывании триггеров
- [ ] Мультичейн (Arbitrum, Optimism)
- [ ] Retry-логика в trigger-checker (повторные попытки при ошибке LI.FI/RPC)
- [ ] Мониторинг ETH-баланса executor-кошелька
