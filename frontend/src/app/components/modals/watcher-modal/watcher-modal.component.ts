import { Component, ChangeDetectionStrategy, input, output, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../modal.component';
import { WatcherFolder, WatcherState } from '../../../models';

export interface WatcherFormData {
  id?: string;
  title: string;
  slug?: string;
  url: string;
  category: string;
  protocol: string;
  pollIntervalMinutes: number;
  defaultTags: string;
  description: string;
}

@Component({
  selector: 'app-watcher-modal',
  standalone: true,
  imports: [CommonModule, FormsModule, ModalComponent],
  templateUrl: './watcher-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatcherModalComponent {
  isOpen = input<boolean>(false);
  mode = input<'create' | 'edit'>('create');
  folders = input<WatcherFolder[]>([]);
  watcherToEdit = input<WatcherState | null>(null);
  initialCategory = input<string>('');
  isValidatingUrl = input<boolean>(false);
  validationResult = input<{ valid: boolean; itemsCount?: number; error?: string } | null>(null);

  close = output<void>();
  save = output<WatcherFormData>();
  validateUrl = output<{ url: string; protocol: string }>();

  id = '';
  title = '';
  slug = '';
  url = '';
  category = '';
  protocol = 'rss';
  pollIntervalMinutes = 15;
  defaultTags = '';
  description = '';

  constructor() {
    effect(() => {
      if (!this.isOpen()) return;

      const editItem = this.watcherToEdit();
      if (this.mode() === 'edit' && editItem) {
        this.id = editItem.id;
        this.title = editItem.title;
        this.slug = editItem.slug;
        this.url = editItem.url || '';
        this.category = editItem.category || 'general';
        this.protocol = editItem.protocol || 'rss';
        this.pollIntervalMinutes = Math.round((editItem.pollIntervalSeconds || 900) / 60);
        this.defaultTags = '';
        this.description = '';
      } else {
        this.id = '';
        this.title = '';
        this.slug = '';
        this.url = '';
        this.category = this.initialCategory() || (this.folders()[0]?.slug ?? 'general');
        this.protocol = 'rss';
        this.pollIntervalMinutes = 15;
        this.defaultTags = '';
        this.description = '';
      }
    });
  }

  onValidate(): void {
    if (!this.url.trim()) return;
    this.validateUrl.emit({
      url: this.url.trim(),
      protocol: this.protocol,
    });
  }

  onClose(): void {
    this.close.emit();
  }

  onSubmit(): void {
    if (!this.title.trim() || !this.url.trim()) return;

    this.save.emit({
      id: this.id || undefined,
      title: this.title.trim(),
      slug: this.slug.trim() || undefined,
      url: this.url.trim(),
      category: this.category,
      protocol: this.protocol,
      pollIntervalMinutes: this.pollIntervalMinutes || 15,
      defaultTags: this.defaultTags.trim(),
      description: this.description.trim(),
    });
  }
}
