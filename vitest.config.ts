/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Pure-logic tests run in Node; add jsdom + setup here if/when component tests are added.
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
