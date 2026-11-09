import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RawNewsItem } from '../../models';
import { formatDate, getRawStatusBadgeClass } from '../../utils/formatters';

@Component({
  selector: 'app-raw-news-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './raw-news-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RawNewsViewComponent {
  rawNewsItems = input<RawNewsItem[]>([]);
  rawNewsTotal = input<number>(0);
  rawNewsLimit = input<number>(25);
  rawNewsOffset = input<number>(0);
  rawNewsStatusFilter = input<string>('');
  isRawNewsLoading = input<boolean>(false);
  convertingRawIds = input<Set<string>>(new Set());
  isProcessingAllPending = input<boolean>(false);
  selectedRawNewsIds = input<Set<string>>(new Set());
  isBatchActionRunning = input<boolean>(false);

  rawNewsStatusFilterChange = output<string>();
  processAllPendingRaw = output<void>();
  loadRawNews = output<void>();
  convertSelectedRawNews = output<void>();
  convertAndPublishSelectedRawNews = output<void>();
  clearSelectedRawNews = output<void>();
  toggleAllRawNewsSelect = output<void>();
  toggleRawNewsSelect = output<string>();
  openRawDetail = output<RawNewsItem>();
  convertSingleRawItem = output<RawNewsItem>();
  convertAndPublishSingleRawNews = output<RawNewsItem>();
  prevRawPage = output<void>();
  nextRawPage = output<void>();

  formatDate = formatDate;
  getRawStatusBadgeClass = getRawStatusBadgeClass;

  isAllRawNewsSelected = computed(() => {
    const list = this.rawNewsItems();
    if (list.length === 0) return false;
    return list.every((item) => this.selectedRawNewsIds().has(item.id));
  });
}
