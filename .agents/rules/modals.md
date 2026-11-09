---
description: Rule and standard for all modals in Lemon Watchers frontend
always_on: true
---

# Modal Window Guidelines and Standard

Все диалоговые и модальные окна в проекте `lemon-watchers` (frontend на Angular) обязаны следовать единому стандарту UX и использовать общий компонент `ModalComponent` (`<app-modal>`).

## 1. Обязательные требования к поведению

1. **Закрытие по клавише Escape (`closeOnEsc`):**
   - При нажатии клавиши `Escape` активное модальное окно обязано закрываться.
   - Это поведение включено по умолчанию в `<app-modal>`.

2. **Закрытие по клику вне окна (`closeOnOutside`):**
   - При клике на затемненную область бэкдропа модальное окно обязано закрываться.
   - Защита от ложных срабатываний: выделение текста внутри инпутов или содержимого модалки с перетаскиванием мыши наружу НЕ должно приводить к закрытию окна (проверяется `mousedown` на подложке и `stopPropagation` на карточке).

3. **Блокировка прокрутки фона (Scroll Lock):**
   - При открытии модалки прокрутка `document.body` блокируется (`overflow: hidden`), а при закрытии или размонтировании — гарантированно восстанавливается.

4. **Доступность (Accessibility):**
   - Подложка имеет атрибуты `role="dialog"`, `aria-modal="true"`, `tabindex="-1"`.
   - Кнопки закрытия (`✕`, «Отмена», «Закрыть») должны иметь `aria-label="Закрыть"` или понятный текст.

---

## 2. Использование общего компонента `<app-modal>`

**Никогда не верстать модальные оверлеи с нуля через `fixed inset-0`!**
Используйте готовый standalone-компонент:
`src/app/components/modal.component.ts`

### Импорт в компонент:
```typescript
import { ModalComponent } from './components/modal.component';

@Component({
  ...
  imports: [CommonModule, ModalComponent],
})
export class MyComponent {
  isModalOpen = signal<boolean>(false);

  openModal(): void {
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }
}
```

### Разметка в шаблоне:
```html
<app-modal
  [isOpen]="isModalOpen()"
  (close)="closeModal()"
  maxWidth="max-w-md"
  panelClass="p-5 space-y-4"
>
  <!-- Шапка -->
  <div class="flex items-center justify-between border-b border-dark-750 pb-3">
    <h3 class="text-base font-bold text-white flex items-center space-x-2">
      <span>Заголовок модалки</span>
    </h3>
    <button (click)="closeModal()" class="text-slate-400 hover:text-white" aria-label="Закрыть">✕</button>
  </div>

  <!-- Тело -->
  <div class="space-y-3 text-xs">
    ...
  </div>

  <!-- Подвал -->
  <div class="flex justify-end space-x-2 pt-2 border-t border-dark-750">
    <button (click)="closeModal()" class="px-4 py-2 rounded-lg bg-dark-800 hover:bg-dark-750 text-slate-300 text-xs font-semibold">
      Отмена
    </button>
    <button (click)="submit()" class="px-4 py-2 rounded-lg bg-lemon-500 hover:bg-lemon-400 text-slate-950 text-xs font-bold transition">
      Подтвердить
    </button>
  </div>
</app-modal>
```

### Доступные параметры `<app-modal>`:

| Входной параметр / Событие | Тип | По умолчанию | Описание |
| :--- | :--- | :--- | :--- |
| `isOpen` | `boolean` | `false` | Управляет видимостью модалки |
| `(close)` | `OutputEmitterRef<void>` | — | Событие запроса закрытия (Esc, клик по фону, кнопка закрытия) |
| `maxWidth` | `string` | `'max-w-md'` | Tailwind-класс ширины (`max-w-lg`, `max-w-2xl`, etc.) |
| `panelClass` | `string` | `''` | Дополнительные классы для контейнера модалки (`p-5`, скроллбар и т.д.) |
| `backdropClass` | `string` | `''` | Дополнительные стили оверлея |
| `closeOnOutside` | `boolean` | `true` | Закрывать ли при клике на оверлей |
| `closeOnEsc` | `boolean` | `true` | Закрывать ли при нажатии клавиши Escape |
