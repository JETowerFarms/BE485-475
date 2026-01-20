module.exports = {
  preset: 'react-native',
  transformIgnorePatterns: [],
  moduleNameMapper: {
    '^react-native-mmkv$': '<rootDir>/__mocks__/react-native-mmkv.js',
    '^react-native-webview$': '<rootDir>/__mocks__/react-native-webview.js',
    '^concaveman$': '<rootDir>/__mocks__/concaveman.js',
    '^react-native-reanimated$': '<rootDir>/__mocks__/react-native-reanimated.js',
    '^react-native-reanimated-carousel$': '<rootDir>/__mocks__/react-native-reanimated-carousel.js',
    '^@react-native-async-storage/async-storage$': '<rootDir>/__mocks__/@react-native-async-storage/async-storage.js',
  },
};
