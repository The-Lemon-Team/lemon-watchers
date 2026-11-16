import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { StoryEvent } from '../../models';
import { formatDate, getStoryBadgeClass, highlightCounts } from '../../utils/formatters';

@Component({
  selector: 'app-story-stream',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './story-stream.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StoryStreamComponent {
  storyEvents = input<StoryEvent[]>([]);
  anyActiveWatchers = input<boolean>(false);
  activeWatchersCount = input<number>(0);
  totalWatchersCount = input<number>(0);
  includeProxyLogs = input<boolean>(false);
  isStoryLoading = input<boolean>(false);

  toggleProxyLogs = output<void>();
  loadStory = output<void>();
  clearEvents = output<void>();
  selectEvent = output<StoryEvent>();

  formatDate = formatDate;
  getStoryBadgeClass = getStoryBadgeClass;
  highlightCounts = highlightCounts;

  getEventWatcherName(event: StoryEvent): string {
    if (event.watcherTitle) return event.watcherTitle;
    if (event.title.includes(':')) {
      return event.title.split(':')[0].trim();
    }
    return event.title;
  }
}
