import {
  Component,
  input,
  output,
  effect,
  HostListener,
  ChangeDetectionStrategy,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule, DOCUMENT } from '@angular/common';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade"
        [class]="backdropClass()"
        [style.z-index]="zIndex"
        (mousedown)="onBackdropMouseDown($event)"
        (click)="onBackdropClick($event)"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
      >
        <div
          class="bg-dark-850 border border-dark-700 rounded-2xl w-full shadow-2xl transition-all"
          [ngClass]="[maxWidth(), panelClass()]"
          (mousedown)="$event.stopPropagation()"
          (click)="$event.stopPropagation()"
        >
          <ng-content></ng-content>
        </div>
      </div>
    }
  `,
})
export class ModalComponent implements OnDestroy {
  private document = inject(DOCUMENT);

  isOpen = input<boolean>(false);
  maxWidth = input<string>('max-w-md');
  panelClass = input<string>('');
  backdropClass = input<string>('');
  closeOnOutside = input<boolean>(true);
  closeOnEsc = input<boolean>(true);

  close = output<void>();

  private static zCounter = 50;
  zIndex = 50;
  private isMouseDownOnBackdrop = false;

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.zIndex = ++ModalComponent.zCounter;
        this.document.body.style.overflow = 'hidden';
      } else {
        this.document.body.style.overflow = '';
      }
    });
  }

  ngOnDestroy(): void {
    this.document.body.style.overflow = '';
  }

  @HostListener('window:keydown.escape', ['$event'])
  onEscape(event?: Event): void {
    if (this.isOpen() && this.closeOnEsc()) {
      event?.preventDefault();
      this.close.emit();
    }
  }

  onBackdropMouseDown(event: MouseEvent): void {
    this.isMouseDownOnBackdrop = event.target === event.currentTarget;
  }

  onBackdropClick(event: MouseEvent): void {
    if (
      this.closeOnOutside() &&
      this.isMouseDownOnBackdrop &&
      event.target === event.currentTarget
    ) {
      this.close.emit();
    }
    this.isMouseDownOnBackdrop = false;
  }
}
