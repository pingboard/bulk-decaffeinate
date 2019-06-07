/**
 * jscodeshift script that converts the .coffee extension for any file that has been
 * converted from coffeescript.
 *
 * This should be run as part of the `fix-imports` pass, in order to update any references
 * across the rest of the codebase. Unlike `remove-coffee-from-imports.js`, it does not
 * update *any* `.coffee` import, but only those which were converted in this pass.
 *
 * For example, given this code, where the files `foo.coffee` and `bar.coffee` were converted:
 *
 * import foo from './foo.coffee'
 * const bar = require('./bar.coffee')
 * import baz from './baz.coffee'
 *
 * becomes this code:
 *
 * import foo from './foo'
 * const bar = require('./bar')
 * import baz from './baz.coffee'
 *
 * To use this script, enable it in the `fixImportsConfig`:
 *
 * ```
 * fixImportsConfig: {
 *   searchPath: "my/javascript/files",
 *   jscodeshiftScripts: [
 *     "remove-coffee-from-all-modified-imports.js"
 *   ]
 * }
 * ```
 */

import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import zlib from 'zlib';

export default function transformer(file, api, options) {
  let decodedOptions = JSON.parse(
    zlib.inflateSync(
      Buffer.from(options['encoded-options'], 'base64')
    ).toString()
  );

  const {convertedFiles, absoluteImportPaths} = decodedOptions;
  const j = api.jscodeshift;

  const thisFilePath = resolve(file.path);

  function convertFile() {
    const root = j(file.source);
    root
      .find(j.ImportDeclaration, {
        source: {
          type: 'Literal',
        },
      })
      .filter(path => {
        let importPath = resolveImportPath(thisFilePath, path.node.source.value);
        return includes(convertedFiles, importPath);
      })
      .forEach(path => {
        let source = path.node.source;
        source.value = stripCoffeeExtension(source.value);
      });
    root
      .find(j.ExportNamedDeclaration, {
        source: {
          type: 'Literal',
        },
      })
      .filter(path => {
        let importPath = resolveImportPath(thisFilePath, path.node.source.value);
        return includes(convertedFiles, importPath);
      })
      .forEach(path => {
        let source = path.node.source;
        source.value = stripCoffeeExtension(source.value);
      });
    root
      .find(j.CallExpression, {
        callee: {
          type: 'Identifier',
          name: 'require',
        },
        arguments: {
          length: 1,
          0: {
            type: 'Literal',
          },
        },
      })
      .filter(path => {
        let importPath = resolveImportPath(thisFilePath, path.node.arguments[0].value);
        return includes(convertedFiles, importPath);
      })
      .forEach(path => {
        let literal = path.node.arguments[0];
        literal.value = stripCoffeeExtension(literal.value);
      });
    return root.toSource();
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
    } else {
      for (let absoluteImportPath of absoluteImportPaths) {
        let absolutePath = resolve(absoluteImportPath, importPath);
        if (existsSync(absolutePath)) {
          return absolutePath;
        }
      }
    }
    return null;
  }

  return convertFile();
}

function stripCoffeeExtension(str) {
  if (str.endsWith('.js.coffee')) {
    return str.replace(/\.js.coffee$/, '');
  }

  if (str.endsWith('.coffee')) {
    return str.replace(/\.coffee$/, '');
  }

  return str;
}

/**
 * Little helper since we don't have Array.prototype.includes.
 */
function includes(arr, elem) {
  return arr.indexOf(elem) > -1;
}
