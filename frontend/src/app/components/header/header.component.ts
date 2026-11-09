import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  sseConnected = input<boolean>(false);
  isTriggeringAll = input<boolean>(false);
  anyActiveWatchers = input<boolean>(false);
  isPausingAll = input<boolean>(false);

  openCreateFolder = output<void>();
  openCreateWatcher = output<void>();
  triggerAll = output<void>();
  toggleAllCollection = output<void>();
}
