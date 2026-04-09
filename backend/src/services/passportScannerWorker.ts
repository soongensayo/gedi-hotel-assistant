import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import path from 'path';
import { config } from '../config';

interface WarmupEvent {
  event: 'warmup_ready' | 'warmup_failed';
  success?: boolean;
  warmup_seconds?: number;
  error?: string;
  cached?: boolean;
}

interface ScanProgressEvent {
  event: 'scan_progress' | 'scan_waiting';
  attempt?: number;
  elapsed?: number;
  error?: string;
  sharpness?: number;
  no_mrz_frames?: number;
}

interface ScanResultEvent {
  event: 'scan_result';
  success: boolean;
  error?: string;
  data?: {
    passport_id: string;
    guest_name: string;
    passport_image_base64: string;
  };
}

type WorkerEvent = WarmupEvent | ScanProgressEvent | ScanResultEvent | { event: string; [key: string]: unknown };

interface ActiveScanHandlers {
  onProgress: (event: ScanProgressEvent) => void;
  onResult: (event: ScanResultEvent) => void;
}

interface WarmupWaiter {
  resolve: (value: WarmupEvent) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
}

class PassportScannerWorkerService {
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private warmupState: 'idle' | 'warming' | 'ready' | 'failed' = 'idle';
  private pendingWarmup: WarmupWaiter | null = null;
  private activeScan: ActiveScanHandlers | null = null;
  private readonly scriptPath = path.resolve(__dirname, '../../scripts/passport_scanner_worker.py');

  private isEnabled(): boolean {
    return config.passportScannerMode === 'live' && config.passportScannerEngine === 'easyocr';
  }

  private spawnWorker(): ChildProcessWithoutNullStreams {
    if (this.child) {
      return this.child;
    }

    const child = spawn(config.passportScannerPython, [this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });

    this.child = child;
    this.stdoutBuffer = '';
    this.stderrBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      let newlineIndex = this.stdoutBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.stdoutBuffer.slice(0, newlineIndex).trim();
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        if (line) {
          this.handleWorkerLine(line);
        }
        newlineIndex = this.stdoutBuffer.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
      let newlineIndex = this.stderrBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.stderrBuffer.slice(0, newlineIndex).trim();
        this.stderrBuffer = this.stderrBuffer.slice(newlineIndex + 1);
        if (line) {
          console.log(`[Passport Worker] ${line}`);
        }
        newlineIndex = this.stderrBuffer.indexOf('\n');
      }
    });

    child.on('error', (err) => {
      console.error(`[Passport Worker] Process error: ${err.message}`);
    });

    child.on('close', (code, signal) => {
      const isCurrentWorker = this.child === child;

      if (this.stderrBuffer.trim()) {
        console.log(`[Passport Worker] ${this.stderrBuffer.trim()}`);
      }

      if (!isCurrentWorker) {
        return;
      }

      this.child = null;
      this.stdoutBuffer = '';
      this.stderrBuffer = '';
      this.warmupState = 'idle';

      if (this.pendingWarmup) {
        clearTimeout(this.pendingWarmup.timer);
        this.pendingWarmup.reject(new Error(`Worker exited during warmup (code=${code}, signal=${signal})`));
        this.pendingWarmup = null;
      }

      if (this.activeScan) {
        const activeScan = this.activeScan;
        this.activeScan = null;
        activeScan.onResult({
          event: 'scan_result',
          success: false,
          error: signal === 'SIGTERM' ? 'Cancelled' : 'Scanner worker exited unexpectedly',
        });
      }

      if (this.isEnabled()) {
        setTimeout(() => {
          void this.prewarm().catch((err) => {
            console.error('[Passport Worker] Auto-rewarm failed:', err instanceof Error ? err.message : String(err));
          });
        }, 1000);
      }
    });

    return child;
  }

  private handleWorkerLine(line: string): void {
    let event: WorkerEvent;
    try {
      event = JSON.parse(line) as WorkerEvent;
    } catch {
      console.log(`[Passport Worker] ${line}`);
      return;
    }

    switch (event.event) {
      case 'warmup_ready':
      case 'warmup_failed': {
        const warmupEvent = event as WarmupEvent;
        if (this.pendingWarmup) {
          clearTimeout(this.pendingWarmup.timer);
          const waiter = this.pendingWarmup;
          this.pendingWarmup = null;
          this.warmupState = warmupEvent.event === 'warmup_ready' ? 'ready' : 'failed';
          if (warmupEvent.event === 'warmup_ready') {
            waiter.resolve(warmupEvent);
          } else {
            waiter.reject(new Error(warmupEvent.error || 'EasyOCR warmup failed'));
          }
        } else if (warmupEvent.event === 'warmup_ready') {
          this.warmupState = 'ready';
        } else {
          this.warmupState = 'failed';
        }
        return;
      }

      case 'scan_progress':
      case 'scan_waiting':
        this.activeScan?.onProgress(event as ScanProgressEvent);
        return;

      case 'scan_result': {
        const scanEvent = event as ScanResultEvent;
        if (this.activeScan) {
          const handlers = this.activeScan;
          this.activeScan = null;
          handlers.onResult(scanEvent);
        }
        return;
      }

      default:
        console.log(`[Passport Worker] Event: ${line}`);
    }
  }

  private sendCommand(command: Record<string, unknown>): void {
    const child = this.spawnWorker();
    child.stdin.write(`${JSON.stringify(command)}\n`);
  }

  async prewarm(): Promise<WarmupEvent> {
    if (!this.isEnabled()) {
      return { event: 'warmup_failed', success: false, error: 'Passport worker disabled' };
    }

    if (this.warmupState === 'ready' && this.child) {
      return { event: 'warmup_ready', success: true, warmup_seconds: 0, cached: true };
    }

    if (this.pendingWarmup) {
      return new Promise<WarmupEvent>((resolve, reject) => {
        const originalResolve = this.pendingWarmup!.resolve;
        const originalReject = this.pendingWarmup!.reject;
        this.pendingWarmup!.resolve = (value) => {
          originalResolve(value);
          resolve(value);
        };
        this.pendingWarmup!.reject = (reason) => {
          originalReject(reason);
          reject(reason);
        };
      });
    }

    this.spawnWorker();
    this.warmupState = 'warming';

    return new Promise<WarmupEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingWarmup) {
          this.pendingWarmup = null;
          this.warmupState = 'failed';
          reject(new Error('Timed out waiting for EasyOCR warmup'));
        }
      }, Math.max(config.passportScannerTimeout, 120000));

      this.pendingWarmup = { resolve, reject, timer };
      this.sendCommand({ command: 'warmup' });
    });
  }

  async startScan(timeoutSeconds: number, handlers: ActiveScanHandlers): Promise<void> {
    if (!this.isEnabled()) {
      throw new Error('Passport worker is disabled');
    }
    if (this.activeScan) {
      throw new Error('Passport scanner is already busy');
    }

    await this.prewarm();
    this.activeScan = handlers;
    this.sendCommand({ command: 'scan', timeout: timeoutSeconds });
  }

  async guideOn(): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }
    this.spawnWorker();
    this.sendCommand({ command: 'guide_on' });
  }

  guideOff(): void {
    if (!this.isEnabled() || !this.child) {
      return;
    }
    this.sendCommand({ command: 'guide_off' });
  }

  cancelActiveScan(): void {
    const child = this.child;
    this.activeScan = null;
    this.child = null;
    this.warmupState = 'idle';
    this.stdoutBuffer = '';
    this.stderrBuffer = '';

    if (this.pendingWarmup) {
      clearTimeout(this.pendingWarmup.timer);
      this.pendingWarmup.reject(new Error('Warmup cancelled'));
      this.pendingWarmup = null;
    }

    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  }

  getWarmupState(): 'idle' | 'warming' | 'ready' | 'failed' {
    return this.warmupState;
  }
}

export const passportScannerWorker = new PassportScannerWorkerService();
