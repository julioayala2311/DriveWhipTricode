// Webpack configuration for RTL (to create style.rtl.css)

const path = require('path');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const RtlCssPlugin = require("rtlcss-webpack-plugin");

// Paths
const rootPath = path.resolve(__dirname);
const entryPath = path.join(rootPath, 'src/styles/styles.scss');
const outputPath = path.join(rootPath, 'src/styles/rtl-css');

module.exports = {
  mode: 'development',
  entry: {
    'styles': entryPath,
  },
  output: {
    path: outputPath,
    filename: '[name].js'
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: '[name].rtl.css',
    }),
    new RtlCssPlugin({
      filename: '[name].rtl.css',
    }),
  ],
  module: {
    rules: [
      {
        test: /\.scss$/,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          {
            loader: 'sass-loader',
            options: {
              sourceMap: true
            }
          }
        ]
      }
    ]
  }
}