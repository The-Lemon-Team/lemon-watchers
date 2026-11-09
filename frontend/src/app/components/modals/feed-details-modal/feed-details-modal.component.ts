import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../modal.component';
import { WatcherArticle, WatcherPingRecord, WatcherState } from '../../../models';
import { formatDate, getResonanceClass } from '../../../utils/formatters';

@Component({
  selector: 'app-feed-details-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  templateUrl: './feed-details-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeedDetailsModalComponent {
  isOpen = input<boolean>(false);
  feed = input<WatcherState | null>(null);
  activeTab = input<'history' | 'articles'>('history');
  pingHistory = input<WatcherPingRecord[]>([]);
  articles = input<WatcherArticle[]>([]);
  articlesTotal = input<number>(0);
  isHistoryLoading = input<boolean>(false);
  isArticlesLoading = input<boolean>(false);
  pollingWatcherIds = input<Set<string>>(new Set());
  folderColorMap = input<Map<string, { icon: string; color: string; title: string }>>(new Map());

  close = output<void>();
  tabChange = output<'history' | 'articles'>();
  triggerWatcher = output<WatcherState>();
  toggleWatcher = output<{ watcher: WatcherState; event: Event }>();
  openArticleModal = output<WatcherArticle>();

  protected readonly Math = Math;
  formatDate = formatDate;
  getResonanceClass = getResonanceClass;

  feedAvgLatency = computed(() => {
    const list = this.pingHistory();
    if (list.length === 0) return 0;
    const sum = list.reduce((acc, p) => acc + (p.latencyMs || 0), 0);
    return Math.round(sum / list.length);
  });

  feedSuccessRate = computed(() => {
    const list = this.pingHistory();
    if (list.length === 0) return 100;
    const ok = list.filter((p) => p.statusCode >= 200 && p.statusCode < 400).length;
    return Math.round((ok / list.length) * 100);
  });

  feed304Count = computed(() => {
    return this.pingHistory().filter((p) => p.statusCode === 304).length;
  });

  getFolderInfo(slug?: string): { icon: string; color: string; title: string } {
    if (!slug) return { icon: '📁', color: '#eab308', title: 'Общее' };
    return this.folderColorMap().get(slug) || { icon: '📁', color: '#94a3b8', title: slug };
  }
}
