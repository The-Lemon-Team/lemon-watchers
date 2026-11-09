import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WatcherFolder } from '../../models';

@Component({
  selector: 'app-folder-tabs',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './folder-tabs.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FolderTabsComponent {
  folders = input<WatcherFolder[]>([]);
  selectedFolderSlug = input<string>('');
  totalWatchersCount = input<number>(0);

  selectFolder = output<string>();
  openCreateFolder = output<void>();
  deleteFolder = output<{ folder: WatcherFolder; event: Event }>();

  onDelete(folder: WatcherFolder, event: Event): void {
    event.stopPropagation();
    this.deleteFolder.emit({ folder, event });
  }
}
