/** Integration tests run against the real MySQL + Redis from docker-compose (no mocked DB). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/env.ts'],
  testTimeout: 30000,
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { strict: true, esModuleInterop: true, resolveJsonModule: true, types: ['node', 'jest'] } }] },
};
