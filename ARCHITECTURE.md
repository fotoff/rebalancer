# Rebalancer — Архитектура

## Версия

| | |
|---|---|
| **Текущая версия** | `v3.0.0` (non-custodial + agents) |
| **Дата** | 2026-08-11 |
| **Сеть** | Base Mainnet |
| **Домен** | [tokenrebalancer.com](https://tokenrebalancer.com) |
| **RebalancerFactory** | `0x24bbf692267b84801D0052812eEDC2885Fc6E171` |
| **UserVault impl** | `0x7512fB65Ed0B56d653262B7500c33B394F3F5a0a` |
| **TimelockController** | `0x597B75a49b4b506c114206Ee0E1b6d02751d62bA` (48ч) |

> **Модель изменилась:** проект перешёл с кастодиального общего vault'а (V2/V3) на
> **non-custodial**: у каждого пользователя свой vault, выводить может только он.
> Старый кастодиальный `RebalancerVault.sol` остаётся в репозитории как legacy.

### История версий

| Версия | Дата | Описание |
|--------|------|----------|
| v1.0.0-alpha | 2026-02-08 | Первый деплой. Vault V1 + Aerodrome Router, Gelato для автоматизации |
| v1.1.0-alpha | 2026-02-08 | Замена Gelato на self-hosted trigger-checker (pm2) |
| v2.0.0-beta.1 | 2026-02-09 | **Vault V2** — generic swap через LI.FI (DEX-агрегатор). Новый контракт, интеграция с SushiSwap и другими DEX через LI.FI API. Vault-балансы в портфеле и карточках пар. История триггеров с TX-ссылками. Статистика ребалансировок |
| v2.0.0-beta.2 | 2026-02-10 | Код-ревью + оптимизация производительности. RPC fallback + multicall batching, staleTime на запросах, code splitting, мемоизация, useTokenInfo hook |
| v2.0.0-beta.3 | 2026-02-10 | Безопасность + архитектура. SQLite вместо JSON, API auth/authz, rate limiting, input validation, structured logging, health check, env validation |
| v2.0.0-beta.4 | 2026-02-11 | Смарт-контракт V3. Whitelist swapTarget, ReentrancyGuard, Pausable, partial fills, per-user pause, fee-on-transfer, 0.15% swap fee, ETH recovery. 47 тестов. Деплой + верификация BaseScan |
| v3.0.0-alpha | 2026-06-29 | **Non-custodial**: RebalancerFactory + персональный UserVault на пользователя, oracle-bounded min-out (Chainlink), TimelockController 48ч, верификация BaseScan |
| v3.1.0 | 2026-06-29 | TWAP-fallback для токенов без Chainlink-фида; trusted-quote режим (opt-in на пару) для пар без оракула; per-pair permissions в UI |
| v3.2.0 | 2026-08-11 | **x402** (pay-per-call API для агентов), публичные метрики `/stats`, **Analytics v2** (коинтеграция + бэктест), **AgentVault** (execution-слой для сторонних агентов) |

---

## Обзор

Сервис автоматической ребалансировки токенов на Base — и **execution-слой для торговых
агентов**. Пользователь разворачивает личный vault, кладёт токены, разрешает конкретные
пары, и система выполняет свопы при срабатывании триггеров.

**Модель:** non-custodial. Средства лежат в персональном vault'е пользователя
(`UserVault`, клон через EIP-1167). Сервис имеет право **только** вызвать `rebalance`
в границах политики, заданной пользователем. Вывод — исключительно владельцем,
и он не блокируется паузой протокола.

**Гарантии в коде:**
- вывести средства может только `owner` (пользователь), пауза на это не влияет;
- выход свопа меряется на самом vault'е → увести его нельзя (revert);
- при наличии оракула (Chainlink или TWAP) min-out считает контракт, а не оператор;
- для пар без оракула — явный opt-in пользователя (`trustOperatorMinOut`).

**Три способа исполнения:**
1. **Наш операторский бот** (`trigger-checker`) → `UserVault.rebalance`
2. **Сторонние агенты** → `AgentVault.agentTrade` с бюджетами и сроком действия
3. **Вручную** пользователем через LI.FI прямо из карточки токена

**DEX-агрегатор:** LI.FI. **Оракулы:** Chainlink + Uniswap-V3-style TWAP fallback.

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

### 4. Смарт-контракты (non-custodial)

#### RebalancerFactory — `0x24bbf692267b84801D0052812eEDC2885Fc6E171`
Разворачивает персональные vault'ы (EIP-1167 клоны) и хранит общий конфиг, который
читают все vault'ы: `operator`, whitelist роутеров, Chainlink-фиды, TWAP-пулы, fee,
kill-switch. **Ни одно из этих прав не даёт доступа к средствам пользователей.**

| Функция | Кто | Назначение |
|---------|-----|------------|
| `deployVault()` | любой | создать свой vault (один на адрес) |
| `getMinOut(from,to,amountIn,slippage)` | view | Chainlink → иначе TWAP-пул |
| `hasOracle(from,to)` | view | отличает «оракула нет» от «оракул протух» |
| `setOperator` / `setRouterAllowed` / `setPriceFeed` / `setTwapPool` / `setFee` / `setPaused` | owner (timelock 48ч) | конфиг |

Константы: `MAX_FEE_RATE = 100` (1%), `MIN_TWAP_PERIOD = 300s`.
Per-token `priceMaxAge` — у стейблов на Base heartbeat ~24ч, у ETH — часы.

#### UserVault — impl `0x7512fB65Ed0B56d653262B7500c33B394F3F5a0a`
Личный vault пользователя. Баланс контракта = баланс пользователя (без общего учёта).

| Функция | Кто |
|---------|-----|
| `deposit` / `depositWithPermit` (EIP-2612) | любой (пополнять безопасно) |
| `withdraw` / `withdrawAll` | **только owner**, никогда не блокируется паузой |
| `setPairPolicy(from,to,allowed,slippage,cooldown,trustOperatorMinOut)` | только owner |
| `rebalance(from,to,amountIn,router,swapData,operatorMinOut)` | только operator фабрики |
| `transferOwnership` | только owner |

`rebalance` проверяет: пара разрешена → не истёк cooldown → роутер в whitelist →
протокол не на паузе → **min-out из оракула** (или, при отсутствии оракула и явном
opt-in пользователя, из котировки оператора) → `received >= minOut`, иначе revert.

#### AgentVault + AgentVaultFactory (v3.2, работают **параллельно** UserVault)
Execution-слой для сторонних торговых агентов. Отдельные контракты — не редеплой
UserVault, существующие пользователи не затронуты. Конфиг читается из RebalancerFactory.

Пользователь выдаёт **каждому агенту** отдельный грант на направление пары:
`setAgentPermission(agent, from, to, enabled, maxSlippageBps, cooldown, expiresAt, maxNotional, trustAgentMinOut)`
плюс скользящий 24ч бюджет: `setAgentBudget(agent, token, dailyLimit)`.

Агент вызывает `agentTrade(...)`. Инварианты те же: вывести не может, выход свопа
меряется на контракте, min-out из оракула. Плюс `canTrade()` — preflight с причиной отказа.

---

## Аналитика (ai-advisor, v3.2)

| Слой | Что делает |
|------|------------|
| `adapters/ohlcv.py` | реальные свечи из GeckoTerminal (TTL-кэш + backoff на 429) |
| `features/pairs_stats.py` | hedge ratio (OLS), z-score спреда, half-life (OU), Hurst, ADF → коинтеграция и режим |
| `backtest/engine.py` | бэктест порогового ребаланса vs HODL с учётом комиссий, max DD, Sharpe, вердикт |
| `routers/analyze.py` | `POST /ai/analyze-pair` |

Важно: `getMinOut`-подобная логика тут ни при чём — это оффчейн-аналитика для UI.
Свечи берутся с параметром `token=<address>`, иначе GeckoTerminal отдаёт цену
**базового** токена пула (WETH и USDC в одном пуле дали бы идентичные ряды).

---

## API для агентов (x402)

| Эндпоинт | Цена | Описание |
|----------|------|----------|
| `POST /api/x402/signal` | $0.01 USDC | AI-сигнал по паре. Ответ `HTTP 402` → оплата → сигнал |
| `GET /api/x402/manifest` | бесплатно | discovery: список платных эндпоинтов и схемы |
| `GET /api/stats` | бесплатно | публичные метрики (vaults/TVL — on-chain) |

Оплата списывается **только при успешном ответе** (`withX402` settle при status < 400).
Сеть и фасилитатор — через `X402_NETWORK` + `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`.

## Безопасность

### Модель доверия (non-custodial)

| Роль | Что может | Чего НЕ может |
|------|-----------|---------------|
| **Пользователь** (owner своего vault'а) | вносить, **выводить в любой момент**, задавать/отзывать политики пар и права агентов | — |
| **Operator** (наш бот, ключ на сервере) | только `rebalance` в границах политики пользователя | вывести средства, тронуть неразрешённую пару, занизить цену ниже оракула |
| **Сторонний агент** (AgentVault) | только `agentTrade` в границах гранта: пары, notional, 24ч бюджет, expiry, cooldown | вывести средства, превысить лимит, продлить себе права |
| **Admin** (owner фабрики = Timelock 48ч) | operator, whitelist роутеров, оракулы, fee (≤1%), pause | **тронуть средства пользователей**, заблокировать вывод |

**Ключевой инвариант:** `withdraw` не читает фабрику вообще и не имеет модификатора
паузы. Даже если фабрика встанет на паузу, сломается или админ-ключ будет
скомпрометирован — вывод средств пользователем продолжит работать.

### Текущие меры
- Контракты верифицированы на BaseScan; owner фабрики — TimelockController (48ч)
- `ReentrancyGuard`, `SafeERC20`, сброс approve в 0, проверка выхода по дельте баланса
- Stale-оракул жёстко ревертит (не деградирует в trusted-режим)
- Slither прогнан: реальных уязвимостей нет, применён CEI-фикс в `deployVault`
- 90 контрактных тестов (включая «оператор/агент не может украсть»)
- SSH: ключевая аутентификация, whitelist IP; UFW; `npm install --ignore-scripts`

### Известные риски и TODO

| Риск | Статус | Решение |
|------|--------|---------|
| Контракты не аудированы (помечены SKELETON/UNAUDITED) | ⚠ открыт | профессиональный аудит перед масштабированием |
| Timelock proposer — одиночный горячий EOA | ⚠ открыт | перевести на multisig (Safe) |
| Trusted-quote пары (без оракула) | by design | пользователь явно соглашается на пару; отозвать можно в любой момент |
| Компрометация ключа оператора | митигировано | ограничено slippage + cooldown 300с; кража невозможна |
| ETH, присланный через `selfdestruct`, застрянет | ⚠ низкий | добавить `rescueETH` при следующем редеплое |
| API без SIWE | ⚠ частично | чтение чужих данных; добавить Sign-In with Ethereum |
| 7 устаревших тестов ai-advisor (под v1 signal API) | ⚠ косметика | переписать под v2 или удалить |

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

### Выполнено (v3.2 — 2026-08-11)
- [x] x402: pay-per-call API для агентов (`/api/x402/signal` + manifest), Base mainnet
- [x] Публичные метрики: `/api/stats` + страница `/stats` (vaults/TVL — on-chain)
- [x] Analytics v2: OHLCV, коинтеграция, half-life, Hurst, бэктест vs HODL с комиссиями
- [x] AgentVault + AgentVaultFactory: бюджеты, expiry, per-agent права (19 тестов)
- [x] Лендинг: позиционирование под агентов/x402, мета-тег `base:app_id`

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
