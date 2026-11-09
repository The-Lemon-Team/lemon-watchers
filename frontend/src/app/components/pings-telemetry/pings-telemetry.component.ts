import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WatcherPingRecord } from '../../models';
import { formatDate } from '../../utils/formatters';

@Component({
  selector: 'app-pings-telemetry',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pings-telemetry.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PingsTelemetryComponent {
  livePings = input<WatcherPingRecord[]>([]);
  clearLog = output<void>();

  formatDate = formatDate;
}
