import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ModalComponent } from '../../modal.component';
import { RawNewsItem } from '../../../models';
import { formatDate, getRawStatusBadgeClass } from '../../../utils/formatters';

@Component({
  selector: 'app-raw-news-detail-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent],
  templateUrl: './raw-news-detail-modal.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RawNewsDetailModalComponent {
  isOpen = input<boolean>(false);
  item = input<RawNewsItem | null>(null);
  convertingRawIds = input<Set<string>>(new Set());

  close = output<void>();
  convertSingleRawItem = output<RawNewsItem>();
  convertAndPublishSingleRawNews = output<RawNewsItem>();

  formatDate = formatDate;
  getRawStatusBadgeClass = getRawStatusBadgeClass;
}
