import getFilesToProcess from './config/getFilesToProcess';
import removeAutogeneratedHeader from './modernize/removeAutogeneratedHeader';
import runEslintFix from './modernize/runEslintFix';
import runFixImports from './modernize/runFixImports';
import runJscodeshiftScripts from './modernize/runJscodeshiftScripts';
import makeCLIFn from './runner/makeCLIFn';
import runWithProgressBar from './runner/runWithProgressBar';
import { JS_FILE_RECOGNIZER } from './util/FilePaths';
import pluralize from './util/pluralize';

export default async function modernizeJS(config) {
  let {decaffeinateArgs = [], decaffeinatePath} = config;

  let jsFiles = await getFilesToProcess(config, JS_FILE_RECOGNIZER);
  if (jsFiles.length === 0) {
    console.log('There were no JavaScript files to convert.');
    return;
  }

  await removeAutogeneratedHeader(jsFiles);
  await runWithProgressBar(
    'Running decaffeinate --modernize-js on all files...',
    jsFiles,
    makeCLIFn(path => `${decaffeinatePath} --modernize-js ${decaffeinateArgs.join(' ')} ${path}`)
  );
  if (config.jscodeshiftScripts) {
    await runJscodeshiftScripts(jsFiles, config);
  }
  if (config.fixImportsConfig) {
    await runFixImports(jsFiles, config);
  }
  await runEslintFix(jsFiles, config, {isUpdate: true});

  console.log(`Successfully modernized ${pluralize(jsFiles.length, 'file')}.`);
  console.log('You should now fix lint issues in any affected files.');
}
