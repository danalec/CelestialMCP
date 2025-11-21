import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';

const DATA_DIR = path.join(process.cwd(), 'data');

// Catalog URLs - using raw GitHub URLs directly
const CATALOGS = [
  {
    url: 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv',
    destination: 'ngc.csv',
    description: 'OpenNGC Catalog'
  },
  {
    url: 'https://raw.githubusercontent.com/astronexus/HYG-Database/master/hyg/CURRENT/hygdata_v41.csv',
    destination: 'hygdata_v41.csv',
    description: 'HYG Database v41'
  }
];

/**
 * Ensure directory exists
 */
function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    console.log(`Creating directory: ${dir}`);
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Download a file from URL
 */
async function downloadFile(url, destination, attempt = 1) {
  const filePath = path.join(DATA_DIR, destination);
  const maxAttempts = 3;
  const timeoutMs = 15000;
  console.log(`Downloading ${url} to ${filePath} (attempt ${attempt}/${maxAttempts})...`);

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const req = protocol.get(url, (response) => {
      if (response.statusCode !== 200) {
        req.destroy();
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const fileStream = fs.createWriteStream(filePath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        console.log(`Successfully downloaded ${destination}`);
        resolve();
      });
      fileStream.on('error', (err) => {
        try { fs.unlinkSync(filePath); } catch {}
        reject(err);
      });
    });

    const timer = setTimeout(() => {
      try { req.destroy(new Error('Timeout')); } catch {}
    }, timeoutMs);

    req.on('close', () => {
      clearTimeout(timer);
    });

    req.on('error', async (err) => {
      clearTimeout(timer);
      if (attempt < maxAttempts) {
        const backoff = Math.min(2000 * Math.pow(2, attempt - 1), 8000);
        setTimeout(async () => {
          try {
            await downloadFile(url, destination, attempt + 1);
            resolve();
          } catch (e) {
            reject(e);
          }
        }, backoff);
      } else {
        reject(err);
      }
    });

    req.end();
  });
}

/**
 * Main function to download all catalogs
 */
async function main() {
  // Ensure data directory exists
  ensureDirectoryExists(DATA_DIR);
  
  // Try to download each catalog
  for (const catalog of CATALOGS) {
    try {
      await downloadFile(catalog.url, catalog.destination);
    } catch (error) {
      console.error(`Failed to download ${catalog.description}: ${error}`);
      console.log('Continuing with next catalog...');
    }
  }
  
  console.log('\nCatalog download complete!');
  console.log('You can now restart the server to use the downloaded catalogs.');
}

// Run the main function
main().catch(error => {
  console.error('An error occurred in the main process:', error);
  process.exit(1);
});
