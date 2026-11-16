import { Component, ChangeDetectionStrategy, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../modal.component';
import { StoryEvent, WatcherArticle, WatcherPingRecord, WatcherState } from '../../../models';
import { formatDate, getResonanceClass, highlightCounts } from '../../../utils/formatters';

@Component({
  selector: 'app-story-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  templateUrl: './story-detail-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StoryDetailModalComponent {
  isOpen = input<boolean>(false);
  event = input<StoryEvent | null>(null);
  watcher = input<WatcherState | null>(null);
  articles = input<WatcherArticle[]>([]);
  articlesTotal = input<number>(0);
  isArticlesLoading = input<boolean>(false);
  pingHistory = input<WatcherPingRecord[]>([]);
  isHistoryLoading = input<boolean>(false);
  folderColorMap = input<Map<string, { icon: string; color: string; title: string }>>(new Map());

  close = output<void>();
  triggerWatcher = output<WatcherState>();
  openArticle = output<WatcherArticle>();

  activeTab = signal<'articles' | 'history'>('articles');

  formatDate = formatDate;
  getResonanceClass = getResonanceClass;
  highlightCounts = highlightCounts;

  setTab(tab: 'articles' | 'history'): void {
    this.activeTab.set(tab);
  }

  getFolderInfo(slug?: string): { icon: string; color: string; title: string } {
    if (!slug) return { icon: '📁', color: '#eab308', title: 'Общее' };
    return this.folderColorMap().get(slug) || { icon: '📁', color: '#94a3b8', title: slug };
  }
}
