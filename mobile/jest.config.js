// Los tests de la lógica corren en Node, sin React Native: son rápidos y abren la base con
// node:sqlite. Babel traduce el TypeScript con el mismo preset que usa la app.
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.[jt]sx?$': 'babel-jest' },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],
}
