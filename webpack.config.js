const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/index.ts',
  output: {
    filename: 'algosdk.min.js',
    path: path.resolve(__dirname, 'dist/browser'),
    library: {
      type: 'umd',
      name: 'algosdk',
    },
  },
  devtool: 'source-map',
  resolve: {
    // Add '.ts' as resolvable extensions
    extensions: ['.ts', '.js'],
    extensionAlias: { '.js': ['.ts', '.js'] },
    // Resolve node_modules at its own path, not a symlink's target, so that a
    // checkout with a symlinked node_modules builds the same bundle (and SRI
    // hash) as a clean one.
    symlinks: false,
  },
  resolveLoader: { symlinks: false },
  module: {
    rules: [
      // All files with a '.ts' extension will be handled by 'ts-loader'.
      {
        test: /\.ts$/,
        loader: 'ts-loader',
        options: {
          configFile: path.resolve(__dirname, 'tsconfig-browser.json'),
        },
      },

      // All output '.js' files will have any sourcemaps re-processed by 'source-map-loader'.
      { test: /\.js$/, loader: 'source-map-loader' },
    ],
    // Don't parse tweetnacl module — https://github.com/dchest/tweetnacl-js/wiki/Using-with-Webpack
    noParse: [/[\\/]tweetnacl[\\/]/, /[\\/]tweetnacl-auth[\\/]/],
  },
};
