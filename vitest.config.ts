import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/main/__tests__/**/*.spec.ts'],
    environment: 'node'
  }
})
