const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeBlockListRegexSource(relativePath) {
  const absPath = path.resolve(__dirname, relativePath);
  const escaped = escapeForRegex(absPath);
  const platformAgnosticPath = escaped.replace(/\\/g, '[/\\\\]');
  return `^${platformAgnosticPath}([/\\\\].*)?$`;
}

const config = {
  server: {
    port: 8085,
  },
  resolver: {
    assetExts: ['db', 'mp3', 'ttf', 'obj', 'png', 'jpg', 'geojson'],
    blockList: new RegExp(
      [
        makeBlockListRegexSource('backend'),
        makeBlockListRegexSource('Datasets'),
        makeBlockListRegexSource('recovery'),
        makeBlockListRegexSource('android/app/build'),
        makeBlockListRegexSource('android/app/.cxx'),
        makeBlockListRegexSource('android/.gradle'),
      ].join('|'),
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
