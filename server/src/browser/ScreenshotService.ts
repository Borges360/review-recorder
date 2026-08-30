import type { Page } from 'playwright';

export class ScreenshotService {
  private counter = 0;

  async capture(page: Page, filePath: string): Promise<void> {
    await page.evaluate(() => {
      const w = globalThis as typeof globalThis & {
        __uiReviewHud?: { hide(): void; show(): void };
      };
      w.__uiReviewHud?.hide();
    });
    try {
      await page.screenshot({ path: filePath, fullPage: false, timeout: 5000 });
    } finally {
      await page.evaluate(() => {
        const w = globalThis as typeof globalThis & {
          __uiReviewHud?: { hide(): void; show(): void };
        };
        w.__uiReviewHud?.show();
      });
    }
  }

  nextFilename(): string {
    this.counter += 1;
    return `screenshot-${String(this.counter).padStart(3, '0')}.png`;
  }

  reset(): void {
    this.counter = 0;
  }
}
