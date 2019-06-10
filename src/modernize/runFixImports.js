/**
 * Runs the fix-imports step on all specified JS files, and return an array of
 * the files that changed.
 */
import { existsSync, readFile, writeFile } from 'fs-promise';
import { basename, dirname, join, relative, resolve } from 'path';
import zlib from 'zlib';

import runWithProgressBar from '../runner/runWithProgressBar';
import execLive from '../util/execLive';
import getFilesUnderPath from '../util/getFilesUnderPath';

const JS_OR_JSX_EXTENSION = /\.jsx?$/;
const COFFEE_EXTENSION = /\.coffee$/;

export default async function runFixImports(jsFiles, config) {
  let {searchPath, absoluteImportPaths, jscodeshiftScripts} = config.fixImportsConfig;
  if (!absoluteImportPaths) {
    absoluteImportPaths = [];
  }
  if(!jscodeshiftScripts) {
    jscodeshiftScripts = [];
  }
  let scriptPath = join(__dirname, '../jscodeshift-scripts-dist/fix-imports.js');

  let options = {
    convertedFiles: jsFiles.map(p => resolve(p)),
    absoluteImportPaths: absoluteImportPaths.map(p => resolve(p)),
  };
  let eligibleFixImportsFiles = await getEligibleFixImportsFiles(
    config, searchPath, jsFiles, JS_OR_JSX_EXTENSION);
  let eligibleFixImportsCoffeeFiles = await getEligibleFixImportsFiles(
    config, searchPath, jsFiles, COFFEE_EXTENSION);

  console.log('Fixing any imports across the whole codebase...');
  if (eligibleFixImportsFiles.length > 0) {
    // Note that the args can get really long, so we take reasonable steps to
    // reduce the chance of hitting the system limit on arg length
    // (256K by default on Mac).
    let eligibleRelativePaths = eligibleFixImportsFiles.map(p => relative('', p));
    let encodedOptions = zlib.deflateSync(JSON.stringify(options)).toString('base64');
    await execLive(`\
      ${config.jscodeshiftPath} --parser flow -t ${scriptPath} \
        ${eligibleRelativePaths.join(' ')} --encoded-options=${encodedOptions}`);

    jscodeshiftScripts.forEach(async (jscodeshiftScript) => {
      console.log(`Running jscodeshift script ${jscodeshiftScript} across the whole codebase...`);
      const jscodeshiftScriptPath = resolveJscodeshiftScriptPath(jscodeshiftScript);
      await execLive(`\
        ${config.jscodeshiftPath} --parser flow -t ${jscodeshiftScriptPath} \
          ${eligibleRelativePaths.join(' ')} --encoded-options=${encodedOptions}`);
    });
  }

  if (eligibleFixImportsCoffeeFiles.length > 0) {
    console.log(`Fixing imports for ${eligibleFixImportsCoffeeFiles.length} coffeescript files...`);

    const convertedFilesWithDefaultExports = getFilesWithDefaultExports(options);

    eligibleFixImportsCoffeeFiles.forEach(filePath => fixImportsForCoffeeScript(filePath, convertedFilesWithDefaultExports));
  }

  return [...eligibleFixImportsFiles, ...eligibleFixImportsCoffeeFiles];
}

async function getEligibleFixImportsFiles(config, searchPath, jsFiles, extension) {
  let jsBasenames = jsFiles.map(p => basename(p, '.js'));
  let resolvedPaths = jsFiles.map(p => resolve(p));
  let allJsFiles = await getFilesUnderPath(searchPath, p => p.match(extension));
  await runWithProgressBar(
    config,
    'Searching for files that may need to have updated imports...',
    allJsFiles,
    async function(p) {
      let resolvedPath = resolve(p);
      if (resolvedPaths.includes(resolvedPath)) {
        return {error: null};
      }
      let contents = (await readFile(resolvedPath)).toString();
      for (let jsBasename of jsBasenames) {
        if (contents.includes(jsBasename)) {
          resolvedPaths.push(resolvedPath);
          return {error: null};
        }
      }
      return {error: null};
    });
  return resolvedPaths;
}

function resolveJscodeshiftScriptPath(scriptPath) {
  if ([
      'prefer-function-declarations.js',
      'remove-coffee-from-imports.js',
      'top-level-this-to-exports.js',
      'remove-coffee-from-all-modified-imports.js',
    ].includes(scriptPath)) {
    return join(__dirname, `../jscodeshift-scripts-dist/${scriptPath}`);
  }
  return scriptPath;
}

function getFilesWithDefaultExports(options) {
  const {convertedFiles} = options;

  return convertedFiles.filter(async (filePath) => {
    const contents = (await readFile(resolve(filePath))).toString();

    return /\nexport default/.test(contents);
  });
}

// Any files that were converted and now have a default export *instead of*
// a commonjs module.export should now update any remaining coffeescript files
// which require them.
//
// Those requires statements should change from `require("../foo")` to
// `require("../foo").default` to properly access the new ES6 exports.
async function fixImportsForCoffeeScript(filePath, convertedFiles) {
  const jsBasenames = convertedFiles.map(p => basename(p, '.js'));

  const resolvedPath = resolve(filePath);

  let contents = (await readFile(resolvedPath)).toString();
  for (let jsBasename of jsBasenames) {
    const pathName = `[a-z\\-\\.\\/]+${jsBasename}(\\.js\\.coffee)?`;
    const requireStatement = `\\w+ = require\\(["'](${pathName})["']\\)`;
    const hasAMatch = contents.match(new RegExp(requireStatement));
    if (hasAMatch) {
      const requireLine = hasAMatch[0];
      const importPath = hasAMatch[1];

      const resolvedImportPath = resolveImportPath(filePath, importPath);

      // Only update this path if it resolves to a converted file
      // (to prevent changing imports for files with the same base name but which
      // are located in a different directory)
      if (resolvedImportPath && convertedFiles.includes(resolvedImportPath)) {
        const updatedLine = `${requireLine.replace(/(\.js)?\.coffee/, '')}.default`;
        contents = contents.replace(requireLine, updatedLine);
      }
    }
  }

  await writeFile(resolvedPath, contents);
}

/**
 * Turn an import string into an absolute path to a JS file.
 */
function resolveImportPath(importingFilePath, importPath) {
  if (importPath.endsWith('.coffee')) {
    importPath = importPath.replace(/\.coffee$/, '');
  }
  if (!importPath.endsWith('.js')) {
    importPath += '.js';
  }
  if (importPath.startsWith('.')) {
    let currentDir = dirname(importingFilePath);
    let relativePath = resolve(currentDir, importPath);
    if (existsSync(relativePath)) {
      return relativePath;
    }
  }
  return null;
}
