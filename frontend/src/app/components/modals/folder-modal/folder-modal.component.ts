import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../modal.component';

@Component({
  selector: 'app-folder-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './folder-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderModalComponent {
  isOpen = input<boolean>(false);
  close = output<void>();
  save = output<{ title: string; slug: string; icon: string; color: string; description: string }>();

  title = '';
  slug = '';
  icon = '📁';
  color = '#eab308';
  description = '';

  reset(): void {
    this.title = '';
    this.slug = '';
    this.icon = '📁';
    this.color = '#eab308';
    this.description = '';
  }

  onClose(): void {
    this.reset();
    this.close.emit();
  }

  onSubmit(): void {
    if (!this.title.trim()) return;
    this.save.emit({
      title: this.title.trim(),
      slug: this.slug.trim(),
      icon: this.icon,
      color: this.color,
      description: this.description.trim(),
    });
    this.reset();
  }
}
