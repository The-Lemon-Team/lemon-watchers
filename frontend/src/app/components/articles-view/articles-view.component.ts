import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WatcherArticle } from '../../models';
import { formatDate } from '../../utils/formatters';

@Component({
  selector: 'app-articles-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './articles-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticlesViewComponent {
  articles = input<WatcherArticle[]>([]);
  articlesTotal = input<number>(0);
  articlesLimit = input<number>(25);
  articlesOffset = input<number>(0);
  articlesViewMode = input<'table' | 'cards'>('table');
  searchQuery = input<string>('');
  selectedArticleIds = input<Set<string>>(new Set());
  busStatus = input<{
    busUrl: string;
    deviceId: string;
    activeSseSubscribers: number;
    total: number;
    published: number;
    pending: number;
  } | null>(null);
  publishingBusIds = input<Set<string>>(new Set());
  isPublishingAllBus = input<boolean>(false);
  isBatchActionRunning = input<boolean>(false);
  folderColorMap = input<Map<string, { icon: string; color: string; title: string }>>(new Map());

  articlesViewModeChange = output<'table' | 'cards'>();
  searchQueryChange = output<string>();
  publishAllPendingToBus = output<void>();
  publishSelectedArticlesToBus = output<void>();
  clearSelectedArticles = output<void>();
  toggleArticleSelect = output<string>();
  toggleAllArticlesSelect = output<void>();
  publishSingleToBus = output<WatcherArticle>();
  openArticleModal = output<WatcherArticle>();
  prevPage = output<void>();
  nextPage = output<void>();

  formatDate = formatDate;

  isAllArticlesSelected = computed(() => {
    const list = this.articles();
    if (list.length === 0) return false;
    return list.every((a) => this.selectedArticleIds().has(a.id));
  });

  getFolderInfo(slug?: string): { icon: string; color: string; title: string } {
    if (!slug) return { icon: '📁', color: '#eab308', title: 'Общее' };
    return this.folderColorMap().get(slug) || { icon: '📁', color: '#94a3b8', title: slug };
  }

  onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchQueryChange.emit(val);
  }
}
