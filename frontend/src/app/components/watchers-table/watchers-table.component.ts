import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WatcherState } from '../../models';
import { formatDate } from '../../utils/formatters';

@Component({
  selector: 'app-watchers-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './watchers-table.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WatchersTableComponent {
  watchers = input<WatcherState[]>([]);
  folderColorMap = input<Map<string, { icon: string; color: string; title: string }>>(new Map());
  pollingWatcherIds = input<Set<string>>(new Set());
  searchQuery = input<string>('');

  searchQueryChange = output<string>();
  triggerWatcher = output<WatcherState>();
  toggleWatcher = output<{ watcher: WatcherState; event: Event }>();
  openEditWatcher = output<{ watcher: WatcherState; event: Event }>();
  openFeedArticles = output<{ watcher: WatcherState; event: Event }>();
  deleteWatcher = output<{ watcher: WatcherState; event: Event }>();

  formatDate = formatDate;

  getFolderInfo(slug?: string): { icon: string; color: string; title: string } {
    if (!slug) return { icon: '📁', color: '#eab308', title: 'Общее' };
    return this.folderColorMap().get(slug) || { icon: '📁', color: '#94a3b8', title: slug };
  }

  onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchQueryChange.emit(val);
  }
}
