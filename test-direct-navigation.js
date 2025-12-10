const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function testDirectNavigation() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  // Create screenshots directory
  const screenshotsDir = path.join(__dirname, 'test-screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir);
  }

  // Capture console messages
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });

  // Capture network errors
  page.on('response', response => {
    if (response.status() >= 400) {
      consoleMessages.push(`[NETWORK ERROR] ${response.status()} ${response.url()}`);
    }
  });

  try {
    console.log('\n========================================');
    console.log('TEST: DIRECT NAVIGATION TO CAMPAIGN DETAIL');
    console.log('========================================\n');

    // Step 1: Login
    console.log('Step 1: Login...');
    await page.goto('http://localhost:3000/login');
    await page.fill('input[type="email"]', 'david.verborgh@gmail.com');
    await page.fill('input[type="password"]', 'Zeweetwel123123+');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
    console.log('✓ Logged in');
    console.log('Current URL:', page.url());

    // Step 2: Direct navigation to campaign detail
    console.log('\nStep 2: Direct navigation to campaign detail...');
    const targetUrl = 'http://localhost:3000/campaigns/abd6aae5-fbf2-42fd-9b9a-d736f99cf5e3';
    console.log('Navigating to:', targetUrl);

    await page.goto(targetUrl, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    console.log('Current URL after navigation:', page.url());
    console.log('URL matches target:', page.url() === targetUrl);

    // Step 3: Inspect page structure
    console.log('\nStep 3: Inspecting page structure...');

    // Get the HTML title
    const title = await page.title();
    console.log('Page title:', title);

    // Check if we're still on the campaigns list or detail page
    const bodyHtml = await page.locator('body').innerHTML();

    // Check for specific indicators
    const hasSessionsPanel = bodyHtml.includes('SESSIONS') || bodyHtml.includes('Sessions');
    const hasGeneratorsPanel = bodyHtml.includes('GENERATORS') || bodyHtml.includes('Generators');
    const hasSoundScapesPanel = bodyHtml.includes('SOUND SCAPES') || bodyHtml.includes('Sound Scapes');
    const hasCampaignGrid = bodyHtml.includes('grid-cols-1 md:grid-cols-2 lg:grid-cols-3');

    console.log('\nPage structure indicators:');
    console.log('- Has campaign grid (list page):', hasCampaignGrid ? '✓' : '✗');
    console.log('- Has Sessions panel:', hasSessionsPanel ? '✓' : '✗');
    console.log('- Has Generators panel:', hasGeneratorsPanel ? '✓' : '✗');
    console.log('- Has Sound Scapes panel:', hasSoundScapesPanel ? '✓' : '✗');

    // Check for main heading text
    const mainHeadingLocator = page.locator('h1');
    const mainHeadingCount = await mainHeadingLocator.count();
    console.log('\nMain heading count:', mainHeadingCount);

    if (mainHeadingCount > 0) {
      const headingText = await mainHeadingLocator.first().innerText();
      console.log('Main heading text:', headingText);
    }

    // Take full page screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, 'direct-navigation.png'),
      fullPage: true
    });
    console.log('\n✓ Screenshot saved: direct-navigation.png');

    // Step 4: Check for Next.js routing issues
    console.log('\nStep 4: Checking for Next.js routing issues...');

    // Check if there's a Next.js error
    const nextErrorLocator = page.locator('text=/application error/i, text=/this page could not be found/i');
    const hasNextError = await nextErrorLocator.count() > 0;
    console.log('Next.js error present:', hasNextError ? 'YES' : 'NO');

    // Get all text from the page
    const pageText = await page.locator('body').innerText();
    console.log('\nFirst 500 characters of page text:');
    console.log(pageText.substring(0, 500));

    // Step 5: Check browser console
    console.log('\nStep 5: Browser console messages:');
    if (consoleMessages.length === 0) {
      console.log('(no console messages)');
    } else {
      consoleMessages.forEach(msg => console.log(msg));
    }

    // Step 6: Check if route exists in Next.js
    console.log('\nStep 6: Testing route existence...');
    const response = await page.goto(targetUrl);
    console.log('HTTP Status:', response?.status());
    console.log('Content-Type:', response?.headers()['content-type']);

    // Keep browser open for inspection
    console.log('\n========================================');
    console.log('Keeping browser open for 10 seconds...');
    console.log('========================================');
    await page.waitForTimeout(10000);

  } catch (error) {
    console.error('\n❌ ERROR:', error.message);
    console.error(error.stack);

    // Take error screenshot
    await page.screenshot({
      path: path.join(screenshotsDir, 'direct-navigation-error.png'),
      fullPage: true
    });
  } finally {
    await browser.close();
  }
}

testDirectNavigation();
