# 🍋 Lemon-Watchers

> **Автономный реактивный сборщик новостей для экосистемы Lemon Calendarium / Lemon Seasons.**

`Lemon-Watchers` — это независимый сервис домашних вотчеров, построенный на парадигме реактивного программирования (**RxJS** + **Lemon Actions**). Сервис заменяет внешних агентов Gemini, перенося полный контроль за обнаружением, фильтрацией, обогащением и доставкой новостей на собственную инфраструктуру.

---

## 🏗️ Архитектура системы

```
                              ┌───────────────────────────────────┐
                              │     SchedulingNeuron (Timer/Cron) │
                              └─────────────────┬─────────────────┘
                                                │ (trigger stream)
                                                ▼
┌──────────────────────┐      ┌───────────────────────────────────┐
│ Внешний первоисточник │ ───► │  WatcherNeuron (Автономный узел)  │
│ (RSS / Atom / JSON)  │ ◄─── │  - HTTP ETag / Conditional GET    │
└──────────────────────┘      │  - PingFlow$ (Latency & Health)   │
                              └─────────────────┬─────────────────┘
                                                │ (raw delta)
                                                ▼
                              ┌───────────────────────────────────┐
                              │        DeltaDetectorNeuron        │
                              │     (GUID / SHA-256 Deduplication)│
                              └─────────────────┬─────────────────┘
                                                │ (new items only)
                                                ▼
                              ┌───────────────────────────────────┐
                              │        GeminiSparkAxon            │
                              │     - Честное event_date (ISO)    │
                              │     - Заголовок & выжимка (Digest)│
                              │     - Теги без '#' и 'jmdaily'    │
                              │     - Оценка резонанса (0..100)   │
                              └───────┬───────────────────┬───────┘
                                      │                   │
                                      ▼                   ▼
                     ┌──────────────────────┐   ┌──────────────────────┐
                     │ PostgreSQL Database  │   │   BusRelayAxon       │
                     │ - Note               │   │   (LemonBus /events) │
                     │ - Feed / Hashtag     │   │   -> SSE broadcast   │
                     │ - Watchers / Pings   │   └──────────────────────┘
                     └──────────────────────┘
```

---

## 🌟 Ключевые возможности

1. **Реактивный конвейер на RxJS:**
   - Управление давлением (backpressure) и concurrency.
   - Изолированные потоки на каждый источник с автоматическим retry и backoff.
   - Наблюдаемость из коробки: поток `pingFlow$` собирает метрики латентности и статус-кодов.
2. **Conditional GET (ETag / If-Modified-Since):**
   - Если на ресурсе нет новых публикаций, сервер возвращает `304 Not Modified`.
   - Нулевой расход трафика и процессора, фиксация успешного пинга с латентностью 0–50 мс.
3. **Строгое соблюдение стандартов Spark / Lemon Seasons:**
   - Честное `event_date` первоисточника.
   - Чистый Frontmatter без запрещенных системных полей (`curator`, `feed`, `process`, `taxonomy`, `lenta_id`).
   - Исключение тега `jmdaily` (зарезервирован для ручной аналитики).
   - Канонический fallback при недоступности AI: система продолжает стабильно работать.
4. **Прямое сохранение в PostgreSQL:**
   - Таблицы `lemon_watchers`, `lemon_watcher_pings`, `lemon_watcher_items` для телеметрии и истории.
   - Создание сущностей `Note`, `Feed`, `Hashtag` в базе данных Lemon Calendarium.
5. **Интеграция с Lemon Bus (`@lenta/lemon-bus`):**
   - Отправка события `NOTE_CREATED` в `http://127.0.0.1:3030/events` с `origin: 'CODING_AGENT'`.
   - Мгновенное появление новости в `Feed App`, `Calendar App` и мобильных клиентах по SSE.

---

## 📡 Каталог проверенных источников

| Категория | Паблик / Вотчер | Протокол | Первоисточник | Целевой Feed |
| :--- | :--- | :--- | :--- | :--- |
| **AI & Нейросети** | `pub-anthropic-news` | Atom | `https://www.anthropic.com/feed.xml` | `spark-ai` |
| **AI & Нейросети** | `pub-deepmind-blog` | RSS | `https://deepmind.google/discover/blog/rss.xml` | `spark-ai` |
| **AI & Нейросети** | `pub-huggingface-papers` | JSON API | `https://huggingface.co/api/daily_papers` | `spark-ai` |
| **AI & Нейросети** | `pub-localllama-rss` | Atom | `https://www.reddit.com/r/LocalLLaMA/.rss` | `spark-ai` |
| **AI & Нейросети** | `pub-openai-releases` | Atom | `https://github.com/openai/openai-python/releases.atom` | `spark-ai` |
| **Кибербезопасность** | `pub-thehackernews` | RSS | `https://feeds.feedburner.com/TheHackersNews` | `spark-cyber-security` |
| **Кибербезопасность** | `pub-bleepingcomputer` | RSS | `https://www.bleepingcomputer.com/feed/` | `spark-cyber-security` |
| **Кибербезопасность** | `pub-cisa-kev` | JSON API | `https://www.cisa.gov/sites/default/files/...` | `spark-cyber-security` |
| **Кибербезопасность** | `pub-securityweek` | RSS | `https://www.securityweek.com/feed/` | `spark-cyber-security` |
| **Хабр & IT** | `pub-habr-best` | RSS | `https://habr.com/ru/rss/best/` | `spark-habr` |
| **Хабр & IT** | `pub-habr-news` | RSS | `https://habr.com/ru/rss/news/` | `spark-habr` |
| **Хабр & IT** | `pub-habr-develop` | RSS | `https://habr.com/ru/rss/flows/develop/all/` | `spark-habr` |
| **Политика & Мир** | `pub-tass-world` | RSS | `https://tass.ru/rss/v-mire.xml` | `spark-politics` |
| **Политика & Мир** | `pub-interfax-main` | RSS | `https://www.interfax.ru/rss.asp` | `spark-politics` |
| **Политика & Мир** | `pub-rbc-news` | RSS | `https://rssexport.rbc.ru/rbcnews/news/30/full.rss` | `spark-politics` |
| **Фронтир & Tech** | `pub-3dnews-news` | RSS | `https://3dnews.ru/news/rss/` | `spark-news-and-frontier` |
| **Фронтир & Tech** | `pub-theverge` | Atom | `https://www.theverge.com/rss/index.xml` | `spark-news-and-frontier` |
| **Фронтир & Tech** | `pub-arstechnica` | RSS | `https://feeds.arstechnica.com/arstechnica/index` | `spark-news-and-frontier` |
| **Фронтир & Tech** | `pub-xakep-feed` | RSS | `https://xakep.ru/feed/` | `spark-xakep` |

---

## 🌐 HTTP & Real-time SSE API

Сервер слушает на порту `3040`:

| Метод | Путь | Описание |
| :--- | :--- | :--- |
| `GET` | `/` | **Angular 21 SPA Dashboard**: таблицы вотчеров, живая лента статей, табы папок, SSE |
| `GET` | `/health` | Статус сервиса, uptime, timestamp |
| `GET` | `/api/v1/metrics` | Агрегированные метрики: активные вотчеры, Success Rate, средняя латентность, число собранных статей |
| `GET` | `/api/v1/folders` | Список папок / категорий с подсчётом активных вотчеров |
| `POST` | `/api/v1/folders` | Создание новой пользовательской папки (категории) |
| `DELETE` | `/api/v1/folders/:id` | Удаление пользовательской папки |
| `GET` | `/api/v1/items` | Список собранных статей с пагинацией (`limit`, `offset`, `category`, `watcherId`, `search`) |
| `GET` | `/api/v1/items/:id` | Детальная информация по конкретной статье |
| `GET` | `/api/v1/watchers` | Список всех настроенных вотчеров с их текущим состоянием |
| `POST` | `/api/v1/watchers` | Добавление нового вотчера с мгновенной регистрацией в движке |
| `POST` | `/api/v1/watchers/validate` | Предварительная валидация RSS/Atom/JSON потока по URL |
| `PATCH` | `/api/v1/watchers/:id` | Включение / выключение вотчера (`{ enabled: boolean }`) |
| `DELETE` | `/api/v1/watchers/:id` | Удаление вотчера и остановка нейрона |
| `GET` | `/api/v1/watchers/:id` | Детальная конфигурация и состояние конкретного вотчера |
| `GET` | `/api/v1/watchers/:id/history?limit=50` | История пингов, латентности и дельт из PostgreSQL |
| `POST` | `/api/v1/watchers/:id/trigger` | Принудительный немедленный опрос конкретного вотчера |
| `POST` | `/api/v1/watchers/trigger-all` | Принудительный запуск опроса всех вотчеров |
| `GET` | `/api/v1/watchers/live` | **SSE поток** живых пингов (`ping`), статей (`article`), метрик (`metrics`) и heartbeat |

---

## 🚀 Команды разработки

```bash
# Установка всех зависимостей (бэкенд + фронтенд)
pnpm install
pnpm install --prefix frontend

# Запуск тестов
pnpm test

# Полная сборка (TypeScript бэкенд + Angular фронтенд)
pnpm run build

# Сборка только бэкенда или только фронтенда
pnpm run build:backend
pnpm run build:frontend

# Запуск Angular фронтенда в режиме разработки (ng serve на :4200)
pnpm run dev:frontend

# Запуск полного сервиса (бэкенд + раздача готового Angular SPA на :3040)
pnpm run dev
```
