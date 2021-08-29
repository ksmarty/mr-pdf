import puppeteer from 'puppeteer-core';
import chrome from 'chrome-aws-lambda';

let contentHTML = '';
export interface generatePDFOptions {
  initialDocURLs: Array<string>;
  excludeURLs?: Array<string>;
  outputPDFFilename?: string;
  pdfMargin?: puppeteer.PDFOptions['margin'];
  contentSelector: string;
  paginationSelector: string;
  pdfFormat?: puppeteer.PDFOptions['format'];
  excludeSelectors?: Array<string>;
  cssStyle?: string;
  puppeteerArgs?: puppeteer.LaunchOptions;
  coverTitle?: string;
  coverImage?: string;
  disableTOC?: boolean;
  coverSub?: string;
}

export async function generatePDF({
  initialDocURLs,
  excludeURLs,
  outputPDFFilename = 'mr-pdf.pdf',
  pdfMargin = { top: 32, right: 32, bottom: 32, left: 32 },
  contentSelector,
  paginationSelector,
  pdfFormat,
  excludeSelectors,
  cssStyle,
  puppeteerArgs,
  coverTitle,
  coverImage,
  disableTOC = false,
  coverSub,
}: generatePDFOptions): Promise<Buffer> {
  const browser = await puppeteer.launch(
    puppeteerArgs ?? {
      args: chrome.args,
      executablePath: await chrome.executablePath,
      headless: chrome.headless,
    },
  );
  const page = await browser.newPage();

  // Iterate through the initial URLs
  for (const url of initialDocURLs) {
    let nextPageURL = url;

    // Create a list of HTML for the content section of all pages by looping
    while (nextPageURL) {
      console.log(`\nRetrieving html from ${nextPageURL}\n`);

      // Go to the page specified by nextPageURL
      await page.goto(nextPageURL, {
        waitUntil: 'networkidle0',
        timeout: 0,
      });

      // If URL is not excluded, evaluate the page
      if (!excludeURLs?.includes(nextPageURL)) {
        contentHTML += await page.evaluate(
          ({ contentSelector }) => {
            /**
             * Element containing the page content. Passed by the caller.
             */
            const content: HTMLElement | null =
              document.querySelector(contentSelector);

            if (content) {
              // Enable page break for PDF
              content.style.pageBreakAfter = 'always';

              // Open each detail tag in the element
              Array.from(content.getElementsByTagName('details')).forEach(
                (detail) => (detail.open = true),
              );
            }

            return content?.outerHTML ?? '';
          },
          { contentSelector },
        );
        // Page has been successfully evaluated
        console.log('Success');
      } else console.log('This URL is excluded.');
      // Otherwise, log that the page is excluded

      // Find next page url before DOM operations
      nextPageURL = await page.evaluate((selector) => {
        return (
          (document.querySelector(selector) as HTMLLinkElement)?.href ?? ''
        );
      }, paginationSelector);
    }
  }

  // Download buffer of coverImage if it exists
  /**
   * Base64 string representing the cover image
   */
  let imgBase64 = '';
  /**
   * Whether the image is an SVG
   */
  let isSVG = false;
  if (coverImage) {
    // Get Image
    const imgSrc = await page.goto(coverImage);

    // Check if image is an SVG
    isSVG =
      imgSrc?.headers()?.['content-type'].toLocaleLowerCase() ===
      'image/svg+xml';

    // Convert image to buffer
    const imgSrcBuffer = await imgSrc?.buffer();

    // Convert image to Base64
    imgBase64 = imgSrcBuffer?.toString('base64') || '';
  }

  // Go to initial page
  await page.goto(initialDocURLs[0], { waitUntil: 'networkidle0' });

  /**
   * HTML for the cover page of the PDF.
   */
  const coverHTML = `
  <div
    class="pdf-cover"
    style="
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100vh;
      page-break-after: always;  
      text-align: center;
    "
  >
    ${coverTitle ? `<h1 class="cover-title">${coverTitle}</h1>` : ''}
    ${
      coverSub
        ? `<h3 class="cover-subtitle" style="font-weight: 500">${coverSub}</h3>`
        : ''
    }
    ${
      coverImage
        ? `<img class="cover-img" src="data:image/${
            isSVG ? 'svg+xml' : 'png'
          };base64, ${imgBase64}" alt="" width="140"height="140" />`
        : ''
    }
  </div>`;

  // Add Toc
  const { modifiedContentHTML, tocHTML } = generateToc(contentHTML);

  // Restructuring the content of the PDF
  await page.evaluate(
    ({ coverHTML, tocHTML, modifiedContentHTML, disableTOC }) =>
      (document.body.innerHTML = `${coverHTML}${
        !disableTOC ? tocHTML : ''
      }${modifiedContentHTML}`),
    { coverHTML, tocHTML, modifiedContentHTML, disableTOC },
  );

  // Remove elements provided by the caller
  if (excludeSelectors)
    await page.evaluate(
      (selectors: string[]) =>
        selectors.forEach((selector: string) =>
          document
            .querySelectorAll(selector)
            .forEach((match) => match.remove()),
        ),
      excludeSelectors,
    );

  // Add CSS to HTML
  if (cssStyle) await page.addStyleTag({ content: cssStyle });

  /**
   * The Final PDF
   *
   * The path is relative to the /tmp/ directory as this is where AWS allows us to store ephemeral data.
   */
  const file = await page.pdf({
    path: `/tmp/${outputPDFFilename}`,
    format: pdfFormat,
    printBackground: true,
    margin: pdfMargin,
  });

  console.log('File Created!');

  return file;
}

function generateToc(contentHtml: string) {
  const headers: {
    header: string;
    level: number;
    id: string;
  }[] = [];

  // Create TOC only for h1~h3
  const modifiedContentHTML = contentHtml.replace(
    /<h[1-3](.+?)<\/h[1-3]( )*>/g,
    htmlReplacer,
  );

  function htmlReplacer(matchedStr: string) {
    // docusaurus inserts #s into headers for direct links to the header
    const headerText = matchedStr
      .replace(/<a[^>]*>#<\/a( )*>/g, '')
      .replace(/<[^>]*>/g, '')
      .trim();

    const headerId = `${Math.random().toString(36).substr(2, 5)}-${
      headers.length
    }`;

    // level is h<level>
    const level = Number(matchedStr[matchedStr.indexOf('h') + 1]);

    headers.push({
      header: headerText,
      level,
      id: headerId,
    });

    const modifiedContentHTML = matchedStr.replace(/<h[1-3].*?>/g, (header) => {
      if (header.match(/id( )*=( )*"/g)) {
        return header.replace(/id( )*=( )*"/g, `id="${headerId} `);
      } else {
        return header.substring(0, header.length - 1) + ` id="${headerId}">`;
      }
    });

    return modifiedContentHTML;
  }

  const toc = headers
    .map(
      (header) =>
        `<li class="toc-item toc-item-${header.level}" style="margin-left:${
          (header.level - 1) * 20
        }px"><a href="#${header.id}">${header.header}</a></li>`,
    )
    .join('\n');

  const tocHTML = `
  <div class="toc-page" style="page-break-after: always;">
    <h1 class="toc-header">Table of contents:</h1>
    <ul class="toc-list">${toc}</ul>
  </div>
  `;

  return { modifiedContentHTML, tocHTML };
}
