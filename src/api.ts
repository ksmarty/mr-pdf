import { generatePDF, generatePDFOptions } from './utils';

/**
 * Main function accessed as an import
 * @param {generatePDFOptions} options - Object containing passed options
 */
export default async function (options: generatePDFOptions) {
  /**
   * Required parameters
   */
  const required = ['initialDocURLs', 'contentSelector', 'paginationSelector'];
  /**
   * Contains all required parameters that are missing from options.
   */
  const missing = required.filter((key) => !Object.keys(options).includes(key));

  if (missing.length) {
    console.error(`You're missing the following fields: ${missing}`);
    return null;
  }

  return await generatePDF(options);
}
