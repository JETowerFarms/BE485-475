// Mock for react-native-mmkv
export const createMMKV = jest.fn(() => ({
  set: jest.fn(),
  getString: jest.fn(),
  delete: jest.fn(),
  clearAll: jest.fn(),
}));