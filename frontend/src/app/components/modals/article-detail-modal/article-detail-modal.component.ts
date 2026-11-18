import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../modal.component';
import { WatcherArticle } from '../../../models';
import { formatDate } from '../../../utils/formatters';

@Component({
  selector: 'app-article-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  templateUrl: './article-detail-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ArticleDetailModalComponent {
  article = input<WatcherArticle | null>(null);
  publishingBusIds = input<Set<string>>(new Set());
  generatingCoverIds = input<Set<string>>(new Set());
  fetchingOriginalCoverIds = input<Set<string>>(new Set());
  assistingArticleIds = input<Set<string>>(new Set());
  folderColorMap = input<Map<string, { icon: string; color: string; title: string }>>(new Map());

  close = output<void>();
  publishSingleToBus = output<WatcherArticle>();
  generateCover = output<WatcherArticle>();
  fetchOriginalCover = output<WatcherArticle>();
  assistContent = output<{
    article: WatcherArticle;
    action: 'rewrite' | 'expand' | 'summarize';
  }>();

  formatDate = formatDate;

  getFolderInfo(slug?: string): { icon: string; color: string; title: string } {
    if (!slug) return { icon: '📁', color: '#eab308', title: 'Общее' };
    return this.folderColorMap().get(slug) || { icon: '📁', color: '#94a3b8', title: slug };
  }
}
