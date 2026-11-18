import { expect } from '@playwright/test';

// Worker startup and decoding run asynchronously, with a 30-second recovery timer in the app.
export const expectPdf = expect.configure({ timeout: 20_000 });
