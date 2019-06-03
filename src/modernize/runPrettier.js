import { exec } from 'mz/child_process';

import runWithProgressBar from '../runner/runWithProgressBar';

export default async function runPrettier(jsFiles, config) {
  await runWithProgressBar(
    config,
    'Running prettier --write on all files...', jsFiles, makePrettierWriteFn(config));
}

function makePrettierWriteFn(config) {
  return async function runPrettierWrite(path) {
    await exec(
      `${config.prettierPath} --write ${path}; :`,
      {maxBuffer: 10000*1024});

    return {error: null};
  };
}
