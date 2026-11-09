# Agent Guidelines: Lemon-Watchers

Проект `lemon-watchers` представляет собой автономный реактивный сервис сбора и обогащения новостных потоков на Node.js/TypeScript (backend) и Angular 21 (frontend).

## Frontend Guidelines

### Модальные окна (Modals & Dialogs)
Все модальные окна обязаны использовать общий компонент [`ModalComponent`](file:///frontend/src/app/components/modal.component.ts) (`<app-modal>`).
Подробный регламент описан в правиле [`.agents/rules/modals.md`](file:///.agents/rules/modals.md):
- **Escape:** Закрытие по клавише `Escape` обязательно (`closeOnEsc = true`).
- **Outside Click:** Закрытие по клику на затемненный бэкдроп обязательно (`closeOnOutside = true`).
- **Scroll Lock:** Автоматическая блокировка и восстановление скролла `document.body`.
- **Защита от случайного закрытия:** Выделение текста внутри инпутов или скроллинг содержимого модалки не закрывают окно.
- Запрещено хардкодить оверлеи через `fixed inset-0` непосредственно в шаблонах страниц.
