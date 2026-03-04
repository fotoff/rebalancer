# Development Log

> **ПРАВИЛО:** Все изменения в коде фиксируются в этом файле. Каждая сессия — отдельный раздел с датой, описанием изменений, затронутыми файлами и причиной. Без записи в DEV_LOG изменение считается недокументированным.

## История разработки

### 2025-02-07
- **Старт проекта.** Реализация по ARCHITECTURE.md
- Выбран вариант C (Custodial): RebalancerVault, максимально простой UX
- Подключение кошелька: RainbowKit
- Сеть: Base (Chain ID 8453)

- **Реализовано:**
  - Monorepo: packages/web, packages/contracts
  - Web: Next.js 15, RainbowKit, Wagmi, viem, Tailwind
  - Providers, Header, ConnectButton
  - PortfolioList — балансы токенов Base через useReadContracts
  - API /api/prices — CoinGecko для цен
  - TokenSelector, PairCreator — создание пар
  - PairDashboard — ratio, переключатель направления, триггеры
  - ManualRebalance — UI ручной ребалансировки
  - RebalancerVault.sol — deposit, withdraw, executeRebalance
  - IAerodromeRouter — интерфейс для swap
  - API /api/pairs, /api/triggers — заглушки для пар и триггеров
  - README, .env.example

### 2025-02-08
- **Запуск:** npm install, npm run dev
- **Internal Server Error:** MetaMask SDK тянет `@react-native-async-storage/async-storage`, которая не резолвится в Next.js
- **Фикс:** webpack alias в next.config.ts → stub `src/lib/async-storage-stub.js` (noop для web)
- **SWC:** при ошибке SWC binary добавлен .babelrc как fallback
- **EMFILE:** на macOS при "too many open files" — запускать `npm run dev:safe` или вручную: `ulimit -n 10240 && npm run dev`
- **Не открывается:** остановить все Next (pkill -f "next dev"), затем `npm run dev:safe`

### 2025-02-08 (сессия 2)
- **TokenSelector — баланс в выпадающем списке** (`packages/web/src/components/pairs/token-selector.tsx`)
  - Добавлен `useReadContract` для `customBalance` (токен по адресу 0x…)
  - Добавлен `useReadContracts` для `globalBalancesData` — balanceOf + decimals для глобальных токенов (результаты поиска GeckoTerminal)
  - Отображение баланса в выпадающем списке для globalTokens и customToken
- **Alchemy для портфеля**
  - Создан `packages/web/.env.local` с ALCHEMY_API_KEY
  - /api/portfolio/scan использует `alchemy_getTokenBalances` — все ERC20 с балансом на Base
- **Портфель: тикеры, цены, сортировка, фильтр**
  - `packages/web/src/app/api/portfolio/scan/route.ts`: для токенов вне KNOWN вызывается `alchemy_getTokenMetadata` — получение symbol и decimals
  - `packages/web/src/app/api/prices/route.ts`: fallback — CoinGecko `/simple/token_price/base?contract_addresses=...` для токенов без TOKEN_IDS; параллельные запросы ids + contract_addresses
  - `packages/web/src/hooks/use-portfolio-tokens.ts`: фильтр `usdValue >= 1`, сортировка по убыванию `usdValue`

### 2025-02-08 (сессия 3)
- **Портфель: показ токенов без цены** (`packages/web/src/hooks/use-portfolio-tokens.ts`)
  - Фикс: токены с `price = 0` (нет в CoinGecko) исключались фильтром `usdValue >= 1`
  - Теперь показываются токены с `usdValue >= 1` ИЛИ `(price === 0 && balance > 0)` — токены без цены отображаются с $0,00

### 2025-02-08 (сессия 4)
- **Портфель: строгий фильтр >$1** (`packages/web/src/hooks/use-portfolio-tokens.ts`)
  - Откат: только `balance > 0 && usdValue >= 1` — не показывать токены с нулевой стоимостью (спам/даст)
- **Цены: сопоставление адресов** (`packages/web/src/app/api/prices/route.ts`)
  - Надёжное сопоставление адресов в ответе CoinGecko (checksum vs lowercase)

### 2025-02-08 (сессия 5)
- **Цены: DexScreener как основной источник** (`packages/web/src/app/api/prices/route.ts`)
  - Первичный источник: DexScreener `GET /tokens/v1/base/{addresses}` — цены из DEX-пар (Base), до 30 адресов за запрос, 300 req/min
  - Fallback: CoinGecko (simple/price + token_price/base) для токенов без пар на DexScreener
  - Улучшает покрытие цен для Base-токенов (OWB, sp-ysUS и др.)
- **Пары: персистентность на диск** (`packages/web/src/app/api/pairs/route.ts`)
  - Пары сохраняются в `data/pairs.json` вместо in-memory
  - После обновления страницы сохранённые пары остаются

### 2025-02-08 (сессия 6)
- **График сравнения монет** (`packages/web/src/components/rebalance/price-chart.tsx`)
  - Новый компонент PriceChart — сравнительный график % изменения двух токенов пары
  - API `/api/chart` — GeckoTerminal OHLCV (поиск лучшего пула, исторические свечи)
  - Интеграция в PairDashboard между "Ratio / Цены" и "Триггеры"
- **Предупреждение о депозите** (`packages/web/src/components/rebalance/pair-dashboard.tsx`)
  - Добавлено предупреждение: для автоматической ребалансировки токены надо задепозитить в контракт
- **Порог отображения портфеля** (`packages/web/src/hooks/use-portfolio-tokens.ts`)
  - Порог снижен с $1 до $0.50 для отображения токенов
- **Пагинация Alchemy** (`packages/web/src/app/api/portfolio/scan/route.ts`)
  - Реализована пагинация через `pageKey` — теперь все ERC20 токены загружаются
- **Удалён FALLBACK_LIST** (`packages/web/src/hooks/use-portfolio-tokens.ts`)
  - Портфель теперь полностью опирается на Alchemy scan для ERC20 и useBalance для ETH
- **Фикс viem v2** (`packages/web/src/components/rebalance/manual-rebalance.tsx`)
  - `waitForTransactionReceipt` → `publicClient.waitForTransactionReceipt({ hash })` (метод клиента вместо импорта)
- **Фикс BigInt** (`packages/web/tsconfig.json`)
  - target: ES2017 → ES2020 для поддержки BigInt литералов (`0n`)
- **Фикс pino-pretty** (`packages/web/next.config.ts`)
  - Вместо stub-файла используется `config.resolve.fallback = { "pino-pretty": false }`
- **Фикс EMFILE / 404** (`packages/web/next.config.ts`)
  - Ошибка `EMFILE: too many open files, watch` — Watchpack не мог создать file watchers на macOS
  - Next.js не обнаруживал `page.tsx` → все запросы шли на `/_not-found` → 404
  - Решение: добавлен `poll: 1000` в watchOptions + запуск с `WATCHPACK_POLLING=true`

### 2025-02-08 (сессия 7) — Вёрстка пары, UX

- **Карточки токенов: иконки + цены + динамика** (`packages/web/src/components/rebalance/pair-dashboard.tsx`)
  - Добавлен компонент `TokenLogo` — загрузка иконок из DexScreener через `useTokenMeta`, fallback — цветной кружок с буквой
  - Цена каждого токена (USD) перенесена в соответствующую карточку (из отдельной карточки "Цены")
  - Добавлены бейджи динамики: 1ч и 24ч изменение цены (зелёный/красный), данные из `useTokenMeta`
  - Стоимость холдинга в USD (`≈ $XXX.XX`) и процент от пары (`XX.X%`) в каждой карточке
  - Для WETH учитывается сумма native ETH + wrapped WETH

- **Полоса аллокации** (`packages/web/src/components/rebalance/pair-dashboard.tsx`)
  - Визуальная горизонтальная полоса распределения (синий — token1, `#d48beb` — token2)
  - Над полосой: проценты каждого токена и итоговая сумма в USD

- **Контракт полностью + ссылка на BaseScan** (`packages/web/src/components/rebalance/pair-dashboard.tsx`)
  - Полный адрес контракта вместо сокращённого (shortAddr удалён)
  - Каждый адрес — ссылка на `basescan.org/token/{address}` с иконкой внешней ссылки

- **Направление: 1 кнопка + ratio** (`packages/web/src/components/rebalance/direction-toggle.tsx`)
  - Вместо двух кнопок-табов — одна кнопка с иконкой swap (стрелки ↕)
  - При нажатии направление переключается, ratio пересчитывается
  - Ratio отображается рядом с кнопкой: "1 WETH = 17,590.2581 OWB"
  - Props обновлены: `fromSym`, `toSym`, `displayRatio` вместо `symbol1`/`symbol2`/`ratio`

- **Предупреждение о WETH** (`packages/web/src/components/rebalance/pair-dashboard.tsx`)
  - Плашка перенесена вниз — после графика (раньше была между карточками и ratio)

- **Цвет второго токена** (`packages/web/src/components/rebalance/price-chart.tsx`, `pair-dashboard.tsx`)
  - Жёлтый (`#eab308` / `amber-400`) заменён на `#d48beb` (сиреневый) — линия графика + полоса аллокации

- **Триггеры: объём ребалансировки** (`packages/web/src/components/rebalance/trigger-form.tsx`)
  - Новый блок "Сколько ребалансировать" с двумя режимами:
    - `% от баланса` — быстрые кнопки 25/50/75/100%, пересчёт в токены
    - `Кол-во токенов` — точное количество, placeholder с доступным балансом, кнопка MAX, подсказка % от баланса
  - Данные `amountMode` и `amount` сохраняются в триггере, отображаются бейджем в списке
  - `fromBalance` передаётся из `pair-dashboard.tsx`
  - Тип `Trigger` расширен полями `amountMode` и `amount`

- **Предупреждение о депозите** (`packages/web/src/components/rebalance/trigger-form.tsx`)
  - Плашка "Для автоматической ребалансировки..." перенесена внутрь карточки триггеров, в низ
  - Удалена внешняя обёртка из `pair-dashboard.tsx`

- **Удалены:** отдельная карточка Ratio, отдельная карточка Цены, функция `shortAddr`

### 2025-02-08 (сессия 8) — Автоматическая ребалансировка

- **Контракт: Ownable + setExecutor** (`packages/contracts/contracts/RebalancerVault.sol`)
  - Добавлен `Ownable` из OpenZeppelin (owner = deployer)
  - `executor` теперь не `immutable` — добавлен `setExecutor(address)` только для owner
  - Добавлены события `ExecutorUpdated`, ошибка `ZeroAddress`
  - Проверка zero address в конструкторе
  - Скрипт деплоя обновлён с подробным логированием

- **ABI экспорт** (`packages/web/src/lib/vault-abi.ts`)
  - Скомпилирован контракт через Hardhat
  - ABI экспортирован как `VAULT_ABI` (typed `as const`) для wagmi/viem

- **Персистентность триггеров** (`packages/web/src/app/api/triggers/route.ts`)
  - In-memory массив заменён на файл `data/triggers.json`
  - Добавлены поля: `amountMode`, `amount`, `status`, `lastTriggered`, `gelatoTaskId`
  - Новый метод `PATCH` для обновления `autoEnabled`, `status`, `lastTriggered`, `gelatoTaskId`
  - GET поддерживает `?autoEnabled=true` для Gelato W3F

- **Vault UI** (`packages/web/src/components/rebalance/vault-panel.tsx`)
  - Новый компонент `VaultPanel` — депозит/вывод токенов в/из RebalancerVault
  - Отображение vault-балансов и wallet-балансов для обоих токенов пары
  - Переключатель Депозит/Вывод, выбор токена, быстрые кнопки 25/50/75/100%
  - Кнопка MAX, approve + deposit/withdraw в одну транзакцию
  - Обработка ошибок, сообщения об успехе
  - Если vault не задеплоен — показывает информационное сообщение
  - Интегрирован в `pair-dashboard.tsx` между графиком и триггерами

- **Gelato Web3 Function** (`packages/gelato-w3f/index.ts`)
  - TypeScript функция для Gelato Automate
  - Логика: fetch триггеров → fetch цен DexScreener → проверка условий
  - При срабатывании: чтение vault balance, вычисление amount, сборка Aerodrome routes
  - `getAmountsOut` для расчёта `amountOutMin` со slippage
  - Возвращает callData для `executeRebalance`
  - Обновляет статус триггера через PATCH API
  - `schema.json` с userArgs: apiBaseUrl, vaultAddress, routerAddress и др.

- **Gelato Task API** (`packages/web/src/app/api/gelato/task/route.ts`)
  - POST — создать Gelato задачу (включить авто-режим для триггера)
  - DELETE — отменить задачу (выключить авто-режим)
  - Обновляет `autoEnabled`, `gelatoTaskId`, `status` в triggers.json
  - Подготовлен для интеграции с `@gelatonetwork/automate-sdk`

- **Auto-mode toggle** (`packages/web/src/components/rebalance/trigger-form.tsx`)
  - Каждый триггер теперь имеет переключатель авто-режима (toggle switch)
  - При включении — вызов POST /api/gelato/task
  - При выключении — вызов DELETE /api/gelato/task
  - Статус: "Gelato мониторит" (зелёный бейдж) или "Авто-режим выкл"
  - Отображение времени последнего срабатывания

- **Скрипт деплоя обновлён** (`packages/contracts/scripts/deploy.ts`)
  - Показывает баланс deployer, проверяет наличие ETH
  - После деплоя: инструкции по настройке vault address и Gelato executor

### 2025-02-09 (сессия 9) — Деплой контракта и сервера

- **Деплой RebalancerVault на Base Mainnet**
  - Контракт задеплоен: `0x21b0601B2fEe4f12A408F16bF2DB503cFdA66278`
  - Deployer: из приватного ключа в `.env` / `.env.local`
  - Hardhat config: добавлен `import "dotenv/config"` для загрузки `.env`
  - Копирование `.env.local` → `packages/contracts/.env`

- **Gelato Executor Setup** (`packages/contracts/scripts/setup-gelato.ts`)
  - Первоначальная попытка через `@gelatonetwork/automate-sdk` не удалась (Ethers v5/v6 несовместимость)
  - Переписан на прямые вызовы Gelato-контрактов через Ethers v6
  - `OpsProxyFactory` (`0x44bde1bccdD06119262f1fE441FBe7341EaaC185`) — получение `dedicatedMsgSender`
  - `vault.setExecutor(dedicatedMsgSender)` — executor установлен на контракте

- **Деплой на сервер** (91.201.114.128)
  - Ubuntu 24.04 LTS, Node.js 20, pm2, Nginx
  - rsync `/Users/viktorbubnov/Downloads/Rebalancer` → `/var/www/rebalancer`
  - `npm install --maxsockets=2` (из-за ограничения памяти)
  - Next.js build: фикс типов `Trigger` (добавлены `status`, `lastTriggered`, `gelatoTaskId`)
  - pm2: запуск Next.js на порту 3001

- **Nginx + SSL** 
  - Конфиг `/etc/nginx/sites-available/tokenrebalancer`
  - SSL: Cloudflare Origin Certificate (`/etc/nginx/ssl/tokenrebalancer.crt` + `.key`)
  - HTTP → HTTPS редирект
  - proxy_pass → `http://127.0.0.1:3001`
  - Домен: `tokenrebalancer.com` (Cloudflare DNS)

- **Безопасность сервера**
  - Обнаружен и удалён криптомайнер-малвей (`/8L9TUpS`, `/t3XUpktz`)
  - SSH hardening: отключён `PasswordAuthentication`, `PermitRootLogin prohibit-password`
  - UFW файрвол: открыты только 22/tcp, 80/tcp, 443/tcp
  - Fail2Ban: защита SSH от брутфорса (`maxretry=3`, `bantime=86400`)
  - Пароль root изменён

- **Gelato W3F задеплоен на IPFS**
  - CID: `QmeqNU16nb94UtuKZaZYs756UHXT5131JDcosTPWwfqs6f`
  - Деплой с локальной машины (сервер OOM при npm install)
  - Ссылка: `https://app.gelato.network/new-task?cid=QmeqNU16nb94UtuKZaZYs756UHXT5131JDcosTPWwfqs6f`

### 2025-02-09 (сессия 10) — Восстановление SSH, полная очистка малвари

- **SSH восстановлен**
  - Fail2Ban заблокировал IP (45.85.105.176 и 195.181.173.214) из-за множества SSH-сессий
  - Разблокировка через VNC-консоль VDSina: `fail2ban-client set sshd unbanip`
  - Fail2Ban смягчён: `maxretry=10`, `bantime=3600` (1ч вместо 24ч)

- **Полная очистка малвари (криптомайнер `x86_64.kok`)**
  - Удалено 7 файлов persistence:
    - `/var/tmp/.monitor` — скрипт перезапуска
    - `/etc/cron.d/root` — crontab с 3 записями `* * * * *`
    - `/etc/inittab` — respawn запись
    - `/etc/init.d/boot.local` — 3 while-loop блока
    - `/etc/init.d/S99network` — while-loop
    - `/etc/init.d/rcS` — 3 while-loop блока
    - `/etc/rc.local` — очищен (оставлен `exit 0`)
  - Очищены `/etc/profile` и `/root/.bashrc` от while-loop блоков
  - Удалены записи из `/var/spool/cron/crontabs/root` и `/var/spool/cron/root`
  - Финальный скан: **ALL CLEAN**

- **Bitcoin нода остановлена**
  - `bitcoind` потреблял 16.5% RAM (665MB), 6.6% CPU
  - `systemctl stop bitcoind && systemctl disable bitcoind`
  - Данные блокчейна: 12GB в `/root/.bitcoin/`

- **Nginx починен**
  - Nginx не запускался — порт 443 был занят `xray-reality` (VPN)
  - `xray-reality` остановлен и отключён от автозапуска
  - Nginx запущен, порты 80/443 работают
  - Сайт: HTTP 200 OK через Nginx → Next.js :3001

### 2025-02-09 (сессия 10–11) — Стабилизация сервера

- **Fail2Ban удалён** (вызывал блокировку SSH при частых подключениях)
- **SSH стабилизирован**
  - Причина обрывов: `ClientAliveInterval 0` (keepalive отключён) + OOM при npm install
  - Фикс: `ClientAliveInterval 60`, `ClientAliveCountMax 5`, `LoginGraceTime 60`
- **OOM решён**
  - Все боты отключены (pm2-root, extended-bot-rise, trading-bot-d29-FF, paradex-amg-bot, web-bot-interface)
  - Bitcoin нода остановлена, данные 12GB удалены
  - xray/xray-reality отключены
  - Старые сервис-файлы systemd удалены
  - Освобождено: 23GB диска, ~1.2GB RAM
  - Next.js лимит: `--max-old-space-size=512`
- **Малварь (финальная зачистка)**
  - 11 точек persistence вычищены
  - `/etc/cron.d/root` заблокирован `chattr +i`
  - Финальный скан: ALL CLEAN
- **pm2 autostart** настроен (systemd pm2-root.service)
- **Gelato API route** обновлён — реальный CID вместо плейсхолдера

### 2025-02-09 (сессия 12) — Переход с Gelato на self-hosted автоматизацию

- **Gelato Functions deprecated** (31 марта 2026)
  - Gelato Onchain Cloud (app.gelato.cloud) объявил Web3 Functions устаревшими
  - Пользователь подтвердил: нужна альтернатива

- **Self-hosted trigger-checker** (`packages/trigger-checker/checker.mjs`)
  - Самостоятельный Node.js скрипт (ESM, viem)
  - Заменяет Gelato W3F — работает локально через pm2
  - Логика: каждые 5 мин fetch triggers → fetch цены DexScreener → проверка условий → executeRebalance
  - Прямой вызов контракта через `walletClient.writeContract` (viem)
  - Ожидание подтверждения TX, обновление статуса триггера через API
  - Конфигурация через env: `PRIVATE_KEY`, `API_BASE_URL`, `BASE_RPC_URL`, `VAULT_ADDRESS`

- **Executor изменён** на контракте
  - Gelato `dedicatedMsgSender` → адрес deployer-кошелька
  - Скрипт `packages/contracts/scripts/set-executor-self.ts`

- **API route обновлён** (`packages/web/src/app/api/gelato/task/route.ts`)
  - Убрана привязка к Gelato W3F CID
  - Документация обновлена: self-hosted checker

- **Gelato W3F** — код сохранён как справочный в `packages/gelato-w3f/`

### 2026-02-09 (сессия 13) — Dynamic token decimals, статистика, pairId, деплой

- **useTokenInfo хук** (`packages/web/src/hooks/use-token-info.ts`)
  - Новый хук для динамического получения symbol и decimals через on-chain ERC-20 вызовы
  - Кэш через KNOWN_TOKENS, fallback на контракт для неизвестных токенов
  - Заменяет hardcoded decimals во всём фронтенде

- **Рефакторинг компонентов на useTokenInfo**
  - `trigger-form.tsx` — RebalanceStats: динамические decimals
  - `portfolio-list.tsx` — замена прямых KNOWN_TOKENS lookups
  - `token-selector.tsx` — замена KNOWN_TOKENS на useTokenInfo
  - `saved-pairs.tsx` — убрана дублирующая логика on-chain fetching
  - `pair-dashboard.tsx` — убрана дублирующая логика on-chain fetching
  - `manual-rebalance.tsx` — замена внутренней логики на useTokenInfo

- **RebalanceStats: исправление отрицательного баланса**
  - "Сейчас" теперь читает реальный vault balance из контракта (useReadContracts)
  - Убрана pair-specific расчётная логика, которая давала отрицательные значения

- **RebalanceStats: общая сумма депозитов**
  - "Внесено" = сумма всех депозитов для монеты из всех пар (без фильтра по pairId)

- **pairId в vault-history**
  - vault-panel.tsx: передаёт pairId при записи deposit/withdraw
  - checker.mjs: передаёт pairId при записи rebalance
  - API vault/history: принимает и фильтрует по pairId

- **cbBTC в KNOWN_TOKENS** — decimals: 8

- **Фикс SNR↔USDC** — синхронизация pairs.json, --exclude='packages/web/data/' в rsync

- **INFO.md** — описание сервиса, roadmap, технология

### 2026-02-10 (сессия 14) — Код-ревью и оптимизация производительности

> **Состояние перед изменениями:** v2.0.0-beta.1
> **Бэкап:** `/var/www/backups/rebalancer-v2.0.0-beta.1-20260210-225652.tar.gz`

- **Полный код-ревью** (4 направления):
  - Производительность: 11 задач (P1–P11)
  - Безопасность: 10 задач (S1–S10)
  - Архитектура: 8 задач (A1–A8)
  - Смарт-контракт: 13 задач (SC1–SC13)

- **Оптимизация производительности** (текущая сессия):
  - P1: staleTime на pairs, triggers, allTriggers
  - P2: RPC fallback + batch.multicall в wagmi.ts
  - P3: Починка мемоизации в useTokenInfo
  - P4: Подъём data fetching в PairDashboard (props/context)
  - P5: Code splitting — next/dynamic для PairDashboard
  - P6: Глобальный price cache
  - P7: Убрать IIFE из JSX в portfolio-list.tsx
  - P8: Двойной .filter() в trigger-form.tsx → useMemo
  - P9: Мемоизация derived data в saved-pairs.tsx
  - P10: Мемоизация derived arrays в use-portfolio-tokens.ts
  - P11: useCallback для handler-ов в page.tsx

- **Безопасность** (S2–S10, S1 отложен):
  - S2: API-аутентификация — INTERNAL_API_KEY для trigger-checker → API. Checker отправляет `x-api-key` header
  - S3: Авторизация — DELETE/PATCH запросы проверяют `userAddress`, пользователь может менять только свои данные
  - S4: Endpoint `GET /api/triggers?autoEnabled=true` закрыт за API-ключом (только checker)
  - S5: Исправлен hardcoded `1e18` в checker.mjs — decimals читаются из ERC-20 контракта с кешированием
  - S6: Rate limiting на все API-роуты (60 GET / 20 POST,PATCH,DELETE в минуту, per-IP)
  - S7: File locking при записи в JSON-файлы (async lock per file path)
  - S8: Валидация входных данных: Ethereum addresses (0x + 40 hex), txHash (0x + 64 hex), числовые значения, диапазоны
  - S9: `estimateGas` вместо hardcoded `gas: 1_500_000n` в checker.mjs (с 20% buffer и fallback)
  - S10: Удалён мёртвый код Gelato (packages/gelato-w3f/, scripts/setup-gelato.ts), `gelatoTaskId` → `autoTaskId`

  **Затронутые файлы (безопасность):**
  - `packages/web/src/lib/api-security.ts` — **НОВЫЙ**: утилиты безопасности (isValidAddress, isValidTxHash, verifyApiKey, checkRateLimit, withFileLock)
  - `packages/web/src/app/api/triggers/route.ts` — rate limit, auth, authz, validation, file lock
  - `packages/web/src/app/api/pairs/route.ts` — rate limit, authz, validation, file lock
  - `packages/web/src/app/api/vault/history/route.ts` — rate limit, validation, file lock
  - `packages/web/src/app/api/gelato/task/route.ts` — authz, rate limit, file lock
  - `packages/web/src/components/pairs/saved-pairs.tsx` — передача userAddress в DELETE
  - `packages/web/src/components/rebalance/trigger-form.tsx` — передача userAddress в DELETE/PATCH
  - `packages/trigger-checker/checker.mjs` — INTERNAL_API_KEY в headers, dynamic decimals, estimateGas
  - `packages/web/.env.local` — добавлен INTERNAL_API_KEY
  - `packages/trigger-checker/ecosystem.config.cjs` — добавлен INTERNAL_API_KEY (на сервере)
  - **Удалено:** `packages/gelato-w3f/` (весь пакет), `packages/contracts/scripts/setup-gelato.ts`

- **Архитектура** (A1–A8):
  - A1: **SQLite** — `better-sqlite3` заменил JSON-файлы. БД: `data/rebalancer.db`, WAL mode, busy_timeout. Миграция: `scripts/migrate-json-to-sqlite.mjs`. 3 таблицы: pairs, triggers, vault_history с индексами
  - A2: Единый формат ответов API — `apiError()`, `badRequest()`, `unauthorized()`, `notFound()`, `rateLimited()`, `internalError()` в `api-utils.ts`
  - A3: Валидация env variables — Zod schema в `env.ts`, crash at startup если переменные невалидны
  - A4: Нормализация адресов — `normalizeAddress()`, `parseAddress()` в `api-utils.ts`, все адреса lowercase
  - A5: Type guards — `isValidAddress()`, `isValidTxHash()`, `parseAddress()` вместо `as Address`
  - A6: Структурированное логирование — `log.info/warn/error(ctx, msg, data?)` → JSON lines в `logger.ts`
  - A7: Health check — `GET /api/health` возвращает статус БД, uptime, список таблиц
  - A8: Верификация контракта — добавлен etherscan config в `hardhat.config.ts` (нужен `BASESCAN_API_KEY`)

  **Затронутые файлы (архитектура):**
  - `packages/web/src/lib/db.ts` — **НОВЫЙ**: SQLite DAL (getDb, pairs, triggers, vaultHistory, dbHealthCheck)
  - `packages/web/src/lib/api-utils.ts` — **НОВЫЙ**: единый формат ошибок, нормализация адресов, type guards
  - `packages/web/src/lib/env.ts` — **НОВЫЙ**: Zod валидация environment variables
  - `packages/web/src/lib/logger.ts` — **НОВЫЙ**: структурированное JSON логирование
  - `packages/web/src/lib/api-security.ts` — упрощён (убран file lock, используются api-utils)
  - `packages/web/src/app/api/pairs/route.ts` — полная переработка на SQLite + новые утилиты
  - `packages/web/src/app/api/triggers/route.ts` — полная переработка на SQLite + новые утилиты
  - `packages/web/src/app/api/vault/history/route.ts` — полная переработка на SQLite + новые утилиты
  - `packages/web/src/app/api/gelato/task/route.ts` — полная переработка на SQLite + новые утилиты
  - `packages/web/src/app/api/health/route.ts` — **НОВЫЙ**: health check endpoint
  - `packages/web/scripts/migrate-json-to-sqlite.mjs` — **НОВЫЙ**: скрипт миграции JSON → SQLite
  - `packages/web/next.config.ts` — добавлен serverExternalPackages для better-sqlite3
  - `packages/web/package.json` — добавлены better-sqlite3, zod
  - `packages/contracts/hardhat.config.ts` — добавлен etherscan config для BaseScan verification

- **Смарт-контракт V3** (SC1–SC13 + комиссия):
  - SC1: **Whitelist swapTarget** — `mapping(address => bool) allowedSwapTargets` + `setSwapTarget(address, bool)` onlyOwner
  - SC2: Запрет `swapTarget == fromToken/toToken/address(this)` — ошибка `InvalidSwapTarget`
  - SC3: **ReentrancyGuard** — `nonReentrant` на `executeRebalance`, `withdraw`, `deposit`
  - SC4: **Partial fills** — измеряет `fromToken` balanceOf delta после свопа, возвращает неиспользованные токены в баланс пользователя
  - SC5: Проверка `fromToken != toToken` — ошибка `SameToken`
  - SC6: **Pausable** — `pause()/unpause()` onlyOwner, `whenNotPaused` на deposit/withdraw/executeRebalance
  - SC7: Executor → multisig — операционная задача (использовать Gnosis Safe как executor через `setExecutor()`)
  - SC8: **Per-user pause** — `mapping(address => bool) userPaused` + `setUserPaused(address, bool)` onlyOwner
  - SC9: Проверки `token/user != address(0)` во всех функциях
  - SC10: Проверка `token.code.length > 0` в deposit — ошибка `NotAContract`
  - SC11: **Fee-on-transfer protection** — deposit использует `balanceOf` delta вместо `amount`
  - SC12: **47 тестов** — покрывают все проверки, fee, admin-функции, edge cases
  - SC13: **ETH recovery** — `withdrawETH()` onlyOwner + `receive()` для приёма ETH
  - **Комиссия 0.15%** — `feeRate = 15` (basis points), вычитается из `amountOut` при каждом свапе, начисляется на `feeCollector`. `setFeeRate()` (макс 1%), `setFeeCollector()` — onlyOwner

  **Деплой V3:**
  - Контракт: `0xf950dA9A11A3D7701470e4F37a68A5e6bC9b177C`
  - Owner: `0x926B4b09Faf5F49e64180B37372c5963F2eA35b7`
  - Executor: `0x66eE7dc2FF768c253C5CeDAa86dfeAea31f47714`
  - LI.FI Diamond whitelisted: `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`
  - Верифицирован на BaseScan: https://basescan.org/address/0xf950dA9A11A3D7701470e4F37a68A5e6bC9b177C#code
  - Старый V2 (`0x3310c9504a7f74d892FB7a527f417d4d46aD78a0`) — пуст, не используется

  **Баг-фикс: trigger-checker `extraEntropy`:**
  - После `npm install better-sqlite3` на сервере обновилась `@noble/curves` до 1.9.x
  - `ox@0.12.1` передавал `extraEntropy: false` в `secp256k1.sign()`, но 1.9.x не принимает `false`
  - Все авто-ребалансировки падали с ошибкой `extraEntropy must be hex string or Uint8Array`
  - Исправлено патчем: `false` → `undefined` в `ox/core/Secp256k1.js`

  **Затронутые файлы (смарт-контракт):**
  - `packages/contracts/contracts/RebalancerVault.sol` — полная переработка V2→V3 + комиссия
  - `packages/contracts/test/RebalancerVault.test.ts` — 47 тестов (все проходят)
  - `packages/contracts/scripts/deploy.ts` — обновлён для V3 + автоматический whitelist LI.FI
  - `packages/contracts/hardhat.config.ts` — добавлен `viaIR: true`, обновлён etherscan V2 API
  - `packages/web/src/lib/vault-abi.ts` — обновлён ABI из V3 компиляции
  - `packages/web/.env.local` — VAULT_ADDRESS обновлён на V3
  - `packages/trigger-checker/ecosystem.config.cjs` (на сервере) — VAULT_ADDRESS обновлён на V3

### 2026-02-11 (сессия 15) — Повторный аудит безопасности + исправления

> **Состояние перед изменениями:** v2.0.0-beta.4

- **Полный аудит системы** (смарт-контракт, сервер, API, trigger-checker, фронтенд):
  - Сервер проверен на малварь — чисто (нет crypto miners, подозрительных процессов, cron-задач)
  - Обнаружено 17 проблем (1 критичная, 3 высоких, 7 средних, 5 низких, 1 инфо)

- **Исправлено (P0 — критичное):** Приватный ключ executor-кошелька в plaintext
  - `ecosystem.config.cjs` перенесён из `/var/www/rebalancer/` в `/root/`
  - Права `chmod 600` (только root)
  - PM2 перезапущен из нового пути, `pm2 save`
  - Старый файл удалён из `/var/www/`

- **Исправлено (P1-a):** Порт 3001 открыт извне
  - `ufw deny 3001` — доступ только через nginx (localhost)

- **Исправлено (P1-b):** Отсутствие security headers в Nginx
  - Добавлены: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `X-XSS-Protection`, `Referrer-Policy`
  - Nginx проверен (`nginx -t`) и перезагружен

- **Исправлено (P1-c):** POST /api/vault/history без аутентификации
  - `type: "rebalance"` теперь требует API key (только trigger-checker)
  - `type: "deposit"` / `"withdraw"` остаются открытыми для фронтенда

- **Исправлено (P2):** SQLite DB с правами 644
  - `chmod 600` на `rebalancer.db`, `.db-shm`, `.db-wal`

- **Исправлено (UX):** Кнопка MAX в триггерах показывала wallet-баланс вместо vault-баланса
  - `pair-dashboard.tsx`: добавлен `useReadContracts` для vault balances
  - `fromBalance` теперь передаёт vault-баланс (из смарт-контракта), а не ERC20 balanceOf кошелька
  - Кнопка MAX и подсказка "Доступно" показывают реальный баланс в vault

- **Записано в бэклог** (при следующем редеплое контракта):
  - Переопределить `renounceOwnership()` → revert
  - Добавить `rescueERC20()` для случайных токенов
  - Timelock на admin-функции

- **Записано в бэклог** (улучшения):
  - SIWE аутентификация (защита GET /api/triggers, /api/pairs от чужих адресов)
  - Retry-логика в trigger-checker
  - Парсинг реального amountOut из event logs (вместо toAmountMin)
  - Мониторинг ETH-баланса executor-кошелька

  **Затронутые файлы:**
  - `packages/web/src/app/api/vault/history/route.ts` — requireApiKey для rebalance
  - `packages/web/src/components/rebalance/pair-dashboard.tsx` — vault balance для fromBalance + импорт VAULT_ABI
  - `/root/ecosystem.config.cjs` (на сервере) — **НОВЫЙ** (перенесён из /var/www/)
  - `/etc/nginx/sites-enabled/tokenrebalancer` (на сервере) — security headers
  - `ARCHITECTURE.md` — обновлён roadmap и бэклог

---

### 2026-02-16: Защита ручной ребалансировки + очистка сервера

**Проблема:** Ручная ребалансировка через LI.FI падала с `TRANSFER_FROM_FAILED`, если токены пользователя находились в Vault, а не в кошельке.

**Решение (manual-rebalance.tsx):**
- Добавлена проверка баланса кошелька (`erc20.balanceOf`) и баланса Vault (`vault.balances`)
- Если на кошельке недостаточно токенов — кнопка заблокирована + красное предупреждение
- Показывается сколько токенов в кошельке и в Vault с рекомендацией вывести из Vault

**Очистка сервера:**
- Удалены файлы документации с production-сервера: `ARCHITECTURE.md`, `DEV_LOG.md`, `INFO.md`, `README.md`, `SERVER_ACCESS.md`
- Документация хранится только локально, на сервере — только рабочий код

**⚠ ИНЦИДЕНТ: потеря БД при деплое**
- При rsync использовался флаг `--delete`, который удалил `data/rebalancer.db` на сервере
- Потеряны: все пары, триггеры, история Vault
- **Причина:** локально файл `data/rebalancer.db` не существует (БД только на сервере), `--delete` удалил всё, чего нет локально
- **Исправление:** обновлены правила деплоя в `.cursor/rules/documentation.mdc` — запрещён `--delete`, добавлен exclude `data`
- Пары и триггеры нужно создать заново через UI

**Изменённые файлы:**
- `packages/web/src/components/rebalance/manual-rebalance.tsx` — wallet/vault balance check + UI warning
- `.cursor/rules/documentation.mdc` — правила деплоя, запрет `--delete`

---

### 2026-02-17: Единая логика vault-балансов + UI триггеров

**Проблема:** В таблице портфеля, карточках пар и внутри пары (VaultPanel) vault-балансы показывались по-разному — каждый компонент делал свой `useReadContracts`, разные query keys → разный кэш → расхождение чисел.

**Решение — VaultBalancesProvider:**
- Добавлен контекст `VaultBalancesProvider` и хук `useVaultBalances(tokenAddresses)` в `packages/web/src/hooks/use-vault-balances.tsx`
- Компоненты регистрируют нужные токены; Provider делает один общий `useReadContracts` для всех vault-балансов
- Единый кэш, refetchInterval 30s, placeholderData для плавного обновления
- Страница обёрнута в Provider (и главная, и вид пары)

**Компоненты переведены на общий источник:**
- `portfolio-list.tsx` — использует `useVaultBalances(allTokenAddrs)`
- `saved-pairs.tsx` — использует `useVaultBalances(uniqueAddrs)`
- `pair-dashboard.tsx` — использует `useVaultBalances([token1, token2])`, передаёт raw bigint в VaultPanel
- `vault-panel.tsx` — vault-балансы только из props (`parentVaultBal1/2`), свой read только для wallet + allowance; после deposit/withdraw вызывает `onVaultChange` для refetch

**Карточки пары (pair-dashboard):**
- В карточках токенов отображаются «Кошелёк» и «Vault» (vault — голубым), USD и % считаются с учётом vault

**Триггеры (trigger-form):**
- Поменяны местами опции: сначала «По цене токена», затем «По ratio»
- По умолчанию выбран режим «По цене токена» (`useState("price")`)

**Изменённые файлы:**
- `packages/web/src/hooks/use-vault-balances.tsx` — новый (Context + Provider + useVaultBalances)
- `packages/web/src/app/page.tsx` — обёртка в VaultBalancesProvider
- `packages/web/src/components/portfolio/portfolio-list.tsx` — useVaultBalances
- `packages/web/src/components/pairs/saved-pairs.tsx` — useVaultBalances
- `packages/web/src/components/rebalance/pair-dashboard.tsx` — useVaultBalances, передача в VaultPanel
- `packages/web/src/components/rebalance/vault-panel.tsx` — приём parentVaultBal, onVaultChange
- `packages/web/src/components/rebalance/trigger-form.tsx` — порядок опций, default metric = price

### 2026-02-25: Скрытие scam-токенов (GoPlus + кэш)

**Реализовано:**
- Таблица `token_scam_cache` в SQLite: `token_address`, `chain_id`, `is_scam`, `checked_at`
- Логика cache-first: сначала проверка по локальной БД, затем GoPlus только для новых токенов
- Интеграция в `/api/portfolio/scan`: после Alchemy и фильтра по symbol, для неизвестных токенов вызывается `checkScamBatch`
- GoPlus: `is_honeypot`, `is_airdrop_scam`, `fake_token` — токены с рисками исключаются из результата
- Известные токены (USDC, WETH, AERO и др.) не проверяются в GoPlus

**Файлы:**
- `packages/web/src/lib/db.ts` — миграция token_scam_cache, tokenScamCache.getBatch/upsertBatch
- `packages/web/src/lib/scam-check.ts` — checkScamBatch (cache + GoPlus API)
- `packages/web/src/app/api/portfolio/scan/route.ts` — вызов checkScamBatch перед возвратом tokens
- `.env.example` — GOPLUS_API_KEY (опционально)

**Деплой:** rsync + build + pm2 restart rebalancer-web

---

## Ссылки и ресурсы

### Кошельки и подключение
- **RainbowKit** https://www.rainbowkit.com/
- **Wagmi** https://wagmi.sh/
- **viem** https://viem.sh/
- **RainbowKit + Base** https://docs.base.org/base-account/framework-integrations/rainbowkit
- **WalletConnect Project ID** https://cloud.walletconnect.com/ (нужен для RainbowKit)

### Base Network
- **Base Mainnet** Chain ID: 8453
- **Base Sepolia** (testnet) Chain ID: 84532
- **Base RPC** https://mainnet.base.org
- **BaseScan** https://basescan.org/

### DEX на Base
- **Aerodrome** https://aerodrome.finance/
- **Aerodrome Router V2** `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
- **Aerodrome SlipStream (V3)** `0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5`
- **Uniswap V3 Base** https://docs.uniswap.org/contracts/v3/reference/deployments
- **BaseSwap** https://baseswap.fi/

### Цены и данные
- **CoinGecko API** https://www.coingecko.com/en/api
  - Simple token price: `GET /api/v3/simple/token_price/{id}`
  - Onchain (по сети): `GET /api/v3/onchain/simple/networks/base/token_price/{addresses}`
  - Документация: https://docs.coingecko.com/reference/simple-token-price
- **CoinGecko Base token IDs** — для simple API нужен id типа "base-aerodrome-finance"
- **GeckoTerminal API** https://www.geckoterminal.com/
  - OHLCV: `GET /api/v2/networks/{network}/pools/{pool}/ohlcv/{timeframe}`
  - Поиск пулов: `GET /api/v2/networks/{network}/tokens/{address}/pools`
  - Используется для графиков сравнения монет
- **DexScreener API** https://docs.dexscreener.com/
  - Token prices: `GET /tokens/v1/{chainId}/{addresses}` — до 30 адресов

### Автоматизация
- **Gelato Network** https://www.gelato.network/
- **Gelato Automate** https://docs.gelatonetwork.com/automate
- **Gelato Base** https://docs.gelatonetwork.com/automate/supported-networks

### Токены Base (адреса для тестов)
- **USDC Base** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **WETH Base** `0x4200000000000000000000000000000000000006`
- **AERO** `0x940181a94A35A4569E4529A3CDfB74e38FD98631`
- **cbETH** `0x2Ae3F1Ec8989c8cf8f6180226674bcb15EE04531`

### OpenZeppelin
- **Contracts** https://docs.openzeppelin.com/contracts/
- **npm** @openzeppelin/contracts

### Инструменты
- **Hardhat** https://hardhat.org/
- **Foundry** https://book.getfoundry.sh/ (альтернатива)
- **Basescan verification** https://basescan.org/verifyContract

---

## Версии зависимостей

### Frontend (packages/web)
- next: ^15
- @rainbow-me/rainbowkit: ^2
- wagmi: ^2
- viem: ^2
- @tanstack/react-query: ^5

### Contracts
- hardhat: ^2
- @openzeppelin/contracts: ^5

---

## Заметки

- CoinGecko бесплатный API: ~10-30 req/min, для production нужен Pro
- Aerodrome использует route structs, не простой path[] как Uniswap V2
- Gelato на Base требует оплату в ETH за выполнение задач
- RainbowKit требует NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID (иначе demo режим)
- npm install может занять 1–2 минуты
- MetaMask SDK / RainbowKit: нужен stub для @react-native-async-storage/async-storage (см. async-storage-stub.js)
- pino-pretty: WalletConnect/pino тянет pino-pretty — решается через webpack fallback `{ "pino-pretty": false }`
- EMFILE на macOS: при большом node_modules Watchpack не может создать watchers → Next.js не видит page.tsx → 404. Решение: `poll: 1000` в watchOptions или `WATCHPACK_POLLING=true`

### 2026-03-04: AI Advisor — MVP "Signals + Policy + Explain"

> **Состояние перед изменениями:** v2.0.0-beta.4
> **Бэкап:** `backups/rebalancer-pre-ai-advisor-20260304-010355.tar.gz`

**Реализовано: полный AI Advisor сервис (Этап 1 — MVP)**

Новый Python/FastAPI сервис `ai-advisor` — анализирует пары токенов, вычисляет сигналы, проверяет guardrails, генерирует объяснения (LLM) и выдаёт рекомендации в формате JSON.

**Архитектура AI Advisor (`packages/ai-advisor/`):**

- **Модуль A — Data Snapshot Layer** (`src/adapters/`, `src/snapshot/`):
  - `market.py` — цены DexScreener + OHLCV GeckoTerminal
  - `quote.py` — котировки LI.FI (slippage, gas, fees)
  - `portfolio.py` — vault/wallet балансы
  - `builder.py` — сборка единого Snapshot
  - `cache.py` — TTL-кэш (15 сек)

- **Модуль B — Feature Engineering** (`src/features/`):
  - `ratio.py` — ratio, log_ratio
  - `momentum.py` — returns 1h/4h/1d
  - `mean_reversion.py` — zscore (окна 24h/72h)
  - `volatility.py` — realized vol, ATR proxy
  - `correlation.py` — Pearson correlation
  - `cost.py` — cost_bps, liquidity_score
  - `calculator.py` — оркестратор всех признаков

- **Модуль C — Signal Engine** (`src/signals/`):
  - `regime.py` — классификация: MEAN_REVERSION / TREND / NEUTRAL
  - `sizing.py` — расчёт % ребаланса как f(|z|, constraints)
  - `triggers.py` — генерация RATIO_BAND / TREND_GUARDED_BAND
  - `engine.py` — основной pipeline: action + edge + pWin + reasons

- **Модуль E — Policy Engine** (`src/policy/`):
  - 9 правил: MAX_SLIPPAGE_BPS, MAX_GAS_USD, MIN_LIQUIDITY_SCORE, MIN_EDGE_AFTER_COST_BPS, MAX_TRADE_PCT, COOLDOWN, MAX_DAILY_TURNOVER, DATA_STALENESS, TOKEN_DENYLIST
  - severity: BLOCK / WARN; любой BLOCK → action=HOLD

- **Модуль F — LLM Layer** (`src/llm/`):
  - `explainer.py` — OpenAI gpt-4o-mini для объяснений на русском
  - `templates.py` — fallback шаблоны при недоступности LLM

- **Модуль G — Output Builder** (`src/output/builder.py`):
  - Сборка Recommendation по JSON schema (Pydantic)
  - Fallback HOLD при ошибке валидации

- **Pipeline** (`src/pipeline.py`):
  - Полная цепочка: Snapshot → Features → Signal → Policy → LLM → Output

- **API Endpoints** (`src/routers/`):
  - `POST /ai/recommend` — рекомендация по паре
  - `POST /ai/suggest-pairs` — предложение пар из портфеля
  - `POST /ai/refresh-quote-and-validate` — валидация перед исполнением
  - `GET /ai/health` — healthcheck

- **Auth**: HMAC-SHA256 подпись между Next.js и ai-advisor

- **Модели данных** (`src/models/`):
  - `snapshot.py` — MarketSnapshot, QuoteSnapshot, PortfolioSnapshot
  - `features.py` — FeatureVector (25+ признаков)
  - `recommendation.py` — Recommendation, Action, Regime, PolicyResult, TriggerSuggestion
  - `request.py` — RecommendRequest, SuggestPairsRequest, ValidateRequest

**Интеграция с Next.js (`packages/web/`):**

- Новые API routes:
  - `src/app/api/ai/recommend/route.ts` — прокси + сохранение в DB
  - `src/app/api/ai/suggest-pairs/route.ts` — прокси
  - `src/app/api/ai/validate/route.ts` — прокси

- Новый клиент: `src/lib/ai-client.ts` — HMAC-подписанные запросы к ai-advisor

- Новые таблицы SQLite: `ai_recommendations`, `ai_policy_violations`
- Новые CRUD: `aiRecommendations.save/getLatest/getByUser/saveViolations` в `db.ts`

- Новые env: `AI_ADVISOR_URL`, `AI_SERVICE_SECRET` в `env.ts`

**UI (`packages/web/src/components/rebalance/`):**

- Новый компонент `ai-advisor.tsx`:
  - Карточка "🤖 AI Advisor" в pair-dashboard (между графиком и VaultPanel)
  - Кнопка "Получить рекомендацию" / "Обновить"
  - Бейдж действия: HOLD / REBALANCE_NOW / SUGGEST_TRIGGERS
  - Метрики: Edge, Cost, pWin
  - Объяснение (short + expandable details)
  - Список policy violations (BLOCK/WARN)
  - Кнопка "Создать триггеры" → автосоздание через /api/triggers
  - Раскрывающийся блок с деталями и факторами

- Новый хук: `src/hooks/use-ai-recommendation.ts`

**Тесты (`packages/ai-advisor/tests/`):**

- `test_features.py` — ratio, momentum, zscore, vol, correlation, cost, calculator
- `test_signals.py` — regime classification, sizing, signal engine actions
- `test_policy.py` — все 9 правил + engine integration
- `test_output.py` — builder, model serialization, HOLD fallback
- `test_api.py` — health endpoint, auth rejection

**Конфигурация деплоя:**
- `ecosystem.config.cjs` — pm2 конфиг для ai-advisor
- `.env.example` — все env переменные с описанием
- Python 3.11+ / FastAPI / uvicorn / numpy / pandas / pydantic / httpx / openai

**Затронутые файлы:**
- `packages/ai-advisor/` — **ВЕСЬ ПАКЕТ НОВЫЙ** (30+ файлов)
- `packages/web/src/lib/db.ts` — таблицы ai_recommendations, ai_policy_violations + CRUD
- `packages/web/src/lib/env.ts` — AI_ADVISOR_URL, AI_SERVICE_SECRET
- `packages/web/src/lib/ai-client.ts` — **НОВЫЙ**: HMAC-клиент для ai-advisor
- `packages/web/src/app/api/ai/recommend/route.ts` — **НОВЫЙ**
- `packages/web/src/app/api/ai/suggest-pairs/route.ts` — **НОВЫЙ**
- `packages/web/src/app/api/ai/validate/route.ts` — **НОВЫЙ**
- `packages/web/src/components/rebalance/ai-advisor.tsx` — **НОВЫЙ**
- `packages/web/src/components/rebalance/pair-dashboard.tsx` — импорт + встройка AiAdvisor
- `packages/web/src/hooks/use-ai-recommendation.ts` — **НОВЫЙ**
