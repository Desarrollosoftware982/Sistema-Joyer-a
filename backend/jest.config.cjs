// jest.config.cjs
module.exports = {
  testEnvironment: 'node',
  // dónde buscaremos tests
  testMatch: ['**/tests/**/*.test.js'],
  // limpiar mocks entre pruebas
  clearMocks: true,
};
