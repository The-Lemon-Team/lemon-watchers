---
description: Architectural standards and best practices for Angular in Lemon Watchers frontend
always_on: true
---

# Angular Architectural Standards & Best Practices

Проект `lemon-watchers` использует **Angular 21** с современным реактивным подходом на основе Signals, автономных компонентов (Standalone Components) и строгой компонентной декомпозиции.

## 1. Компонентная архитектура (Container / Presentational Pattern)

1. **Разделение на Smart (Container) и Dumb (Presentational) компоненты:**
   - **Smart-компоненты (Контейнеры):** например, `App` (`app.ts`). Отвечают за оркестрацию бизнес-логики, взаимодействие с сервисами (`WatchersService`), хранение основного состояния в `signal()`, подписку на SSE и передачу данных в презентационные компоненты через свойства/входы (`input()`).
   - **Presentational-компоненты:** например, `HeaderComponent`, `MetricsBarComponent`, `FolderTabsComponent`, `WatchersTableComponent`, `ArticlesViewComponent`, `StoryStreamComponent`, `RawNewsViewComponent`. Принимают данные через `input()`, уведомляют контейнер о действиях пользователя через `output()`, не имеют прямых зависимостей от API/SSE-сервисов и используют `ChangeDetectionStrategy.OnPush`.

2. **Ограничение размеров файлов:**
   - Запрещено создавать монолитные компоненты типа «God Object».
   - Размер шаблона (`.html`) компонента не должен превышать 200–250 строк. Если шаблон растет, выделяйте логические блоки в отдельные подкомпоненты.
   - Размер TypeScript-файла (`.ts`) не должен превышать 250–350 строк.

3. **Диалоговые и модальные окна:**
   - Все модалки обязаны находиться в `components/modals/` и оборачивать базовый `<app-modal>` в соответствии с правилом `.agents/rules/modals.md`.
   - Форма и локальные поля ввода должны быть инкапсулированы внутри модального компонента (`FolderModalComponent`, `WatcherModalComponent` и т.д.), не засоряя состояние контейнера.

## 2. Реактивность и Signals API

1. **Signals-First:**
   - Для хранения изменяемого локального состояния используется `signal<T>()`.
   - Для производных значений и фильтраций используется `computed(() => ...)`.
   - Входные параметры компонентов объявляются через функцию `input()` / `input.required()`.
   - Выходные события объявляются через `output<T>()`.

2. **Стратегия обнаружения изменений (Change Detection):**
   - Все компоненты должны явно указывать `changeDetection: ChangeDetectionStrategy.OnPush`.

3. **Dependency Injection:**
   - Используйте современную функцию `inject(Service)` вместо инъекций в конструктор.

4. **RxJS и SSE:**
   - Долговременные подписки (SSE, WebSocket, таймеры) должны быть очищены в `ngOnDestroy()` (через `Subscription.unsubscribe()` или `takeUntilDestroyed()`).

## 3. Утилиты и форматирование

- Общие функции форматирования (даты, классы индикаторов статуса, вычисление скоринга резонанса) выносятся в `utils/formatters.ts`, предотвращая дублирование в шаблонах и контроллерах.
