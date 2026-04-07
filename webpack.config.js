const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

const appDirectory = __dirname;

const babelLoaderConfiguration = {
  test: /\.(js|jsx|ts|tsx)$/,
  include: [
    path.resolve(appDirectory, 'index.web.js'),
    path.resolve(appDirectory, 'App.js'),
    path.resolve(appDirectory, 'src'),
    // Include RN ecosystem packages that ship un-transpiled ES modules
    path.resolve(appDirectory, 'node_modules/react-native-vector-icons'),
    path.resolve(appDirectory, 'node_modules/react-native-reanimated'),
    path.resolve(appDirectory, 'node_modules/react-native-gesture-handler'),
    path.resolve(appDirectory, 'node_modules/react-native-safe-area-context'),
    path.resolve(appDirectory, 'node_modules/react-native-reanimated-carousel'),
    path.resolve(appDirectory, 'node_modules/react-native-svg'),
  ],
  use: {
    loader: 'babel-loader',
    options: {
      cacheDirectory: true,
      presets: ['module:@react-native/babel-preset'],
      plugins: ['react-native-reanimated/plugin', 'react-native-web'],
    },
  },
};

const imageLoaderConfiguration = {
  test: /\.(gif|jpe?g|png|svg)$/,
  type: 'asset/resource',
};

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';

  return {
    entry: path.resolve(appDirectory, 'index.web.js'),
    output: {
      path: path.resolve(appDirectory, 'dist'),
      filename: 'bundle.[contenthash].js',
      publicPath: '/',
      clean: true,
    },
    resolve: {
      extensions: ['.web.js', '.js', '.web.ts', '.ts', '.web.tsx', '.tsx', '.json'],
      alias: {
        'react-native$': 'react-native-web',
        'react-native-webview': path.resolve(appDirectory, 'src/web-shims/react-native-webview.js'),
        'react-native-mmkv': path.resolve(appDirectory, 'src/web-shims/react-native-mmkv.js'),
        'concaveman': path.resolve(appDirectory, 'src/web-shims/concaveman.js'),
      },
    },
    module: {
      rules: [
        babelLoaderConfiguration,
        imageLoaderConfiguration,
        {
          test: /\.js$/,
          resolve: { fullySpecified: false },
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        __DEV__: JSON.stringify(!isProduction),
      }),
      new webpack.ProvidePlugin({
        process: 'process/browser',
      }),
      new HtmlWebpackPlugin({
        template: path.resolve(appDirectory, 'public/index.html'),
      }),
    ],
    devServer: {
      static: path.resolve(appDirectory, 'dist'),
      port: 8080,
      historyApiFallback: true,
    },
  };
};
