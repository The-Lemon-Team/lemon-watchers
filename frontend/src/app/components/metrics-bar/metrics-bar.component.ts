import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WatcherMetricsSnapshot } from '../../models';

@Component({
  selector: 'app-metrics-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './metrics-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsBarComponent {
  metrics = input<WatcherMetricsSnapshot | null>(null);
}
