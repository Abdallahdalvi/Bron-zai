const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
require("dotenv").config();
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const APPLIED_JOBS_FILE = path.join(__dirname, "applied-jobs-marketing.json");

// Load already applied jobs
function loadAppliedJobs() {
  if (fs.existsSync(APPLIED_JOBS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(APPLIED_JOBS_FILE, "utf8"));
    } catch (e) {
      return [];
    }
  }
  return [];
}

// Save applied jobs
function saveAppliedJob(jobId, jobTitle, company) {
  const list = loadAppliedJobs();
  list.push({ id: jobId, title: jobTitle, company, date: new Date().toISOString() });
  fs.writeFileSync(APPLIED_JOBS_FILE, JSON.stringify(list, null, 2));
}

// OpenRouter AI Generation Helper
async function askAI(question, jdText, jobTitle, company) {
  console.log(`🤖 Asking AI for answer to: "${question.substring(0, 60).replace(/\n/g, ' ')}..."`);
  const prompt = `
You are an expert job application assistant. Write a customized, highly professional, 3-sentence cover letter/answer for this application question.

CANDIDATE PROFILE:
- Name: Abdallah Dalvi
- Phone: +91 7400239134
- Email: dalviabdallah76@gmail.com
- Location: Mumbai, India (open to remote/WFH)
- Summary: Digital Marketing Professional with 3+ years of experience in social media strategy, content creation, and community management. Expert in Canva, Meta Suite, SEMrush, SEO.
- Last Role: Social Media Executive at Indian Television Dot Com (Feb 2024 – May 2025)
- Education: HSC Science (Maharashtra State Board)

JOB DETAILS:
- Title: ${jobTitle}
- Company: ${company}
- Job Description: ${jdText}

QUESTION:
"${question}"

RULES:
1. Provide EXACTLY a 3-sentence response. No more, no less.
2. Customization: Tailor it specifically to the Job Description and candidate profile.
3. Be professional, enthusiastic, and confident.
4. Do NOT use any emojis.
5. Return ONLY the answer text. No extra headers, introductory phrases, or polite filler. Just start directly with the first sentence of your response.
`;

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_KEY}`,
        "HTTP-Referer": "https://github.com/Abdallahdalvi/Bron-zai",
        "X-Title": "Bron Job Assistant"
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5
      })
    });
    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      const ans = data.choices[0].message.content.trim();
      console.log(`🤖 AI Answer: "${ans.substring(0, 80).replace(/\n/g, ' ')}..."`);
      return ans;
    }
  } catch (error) {
    console.error("AI Generation Error:", error);
  }
  return "I believe my background as a Social Media Executive and 3+ years of digital marketing experience make me a strong fit for this role. I am skilled in Canva, Meta Suite, and community management, allowing me to start delivering value immediately. I look forward to contributing to your team.";
}

function getSimpleAnswer(question) {
  const q = question.toLowerCase();
  if (q.includes("experience") || q.includes("years")) return "3";
  if (q.includes("notice") || q.includes("joining") || q.includes("available")) return "Immediate";
  if (q.includes("city") || q.includes("location") || q.includes("where")) return "Mumbai";
  if (q.includes("salary") || q.includes("ctc") || q.includes("expectation")) return "35000";
  return null;
}

async function forceClickApply(page) {
  const applySelectors = [
    '#easy_apply_button',
    '#top_easy_apply_button',
    'button:has-text("Apply now")',
    'button:has-text("Apply")',
    'a.btn:has-text("Apply")',
    'a.btn:has-text("Apply now")'
  ];

  for (const sel of applySelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() && await btn.isVisible()) {
        await btn.scrollIntoViewIfNeeded();
        // Use force:true to bypass any overlay intercepting the click
        await btn.click({ delay: 200, force: true });
        console.log(`   ✅ Clicked Apply button using selector: ${sel}`);
        return true;
      }
    } catch {}
  }
  
  // Fallback: evaluate JS click
  try {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('#easy_apply_button, #top_easy_apply_button, button.apply');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    if (clicked) {
      console.log(`   ✅ Clicked Apply button using evaluate fallback`);
      return true;
    }
  } catch {}

  return false;
}

async function isAlreadyAppliedUI(page) {
  return await page.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    return t.includes("already applied") || t.includes("you have applied");
  });
}

async function clickSubmit(page) {
  const submitSelectors = [
    '#submit',
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Submit application")',
    'button:has-text("Apply")',
    'input[value="Submit"]',
    '.submit-button',
    '.btn-primary'
  ];
  
  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).filter({ visible: true }).first();
      if (await btn.count()) {
        const text = await btn.innerText().catch(() => "");
        if (text && (text.toLowerCase().includes("cancel") || text.toLowerCase().includes("back"))) {
          continue;
        }
        await btn.click({ delay: 100, force: true, timeout: 2000 });
        console.log(`   🚀 Clicked Submit button (selector: ${sel})`);
        return true;
      }
    } catch {}
  }

  // Fallback: evaluate JS click
  try {
    const clicked = await page.evaluate(() => {
      const selectors = [
        '#submit', 'button[type="submit"]', 'input[type="submit"]',
        'button.submit', '.submit-button', '.btn-primary',
        'input[value="Submit"]'
      ];
      for (const sel of selectors) {
        const btn = document.querySelector(sel);
        if (btn && btn.offsetHeight > 0) {
          const text = btn.innerText?.toLowerCase() || "";
          if (text.includes("cancel") || text.includes("back")) continue;
          btn.click();
          return sel;
        }
      }
      // Fallback 2: find any blue/primary button
      const buttons = Array.from(document.querySelectorAll('button, a.btn, input[type="submit"]'));
      const primaryBtn = buttons.reverse().find(btn => {
        const text = btn.innerText?.trim().toLowerCase();
        const cls  = btn.className?.toLowerCase() || "";
        return text && (text.includes('submit') || text.includes('apply')) && 
               (cls.includes('btn-primary') || cls.includes('btn-blue') || cls.includes('submit'));
      });
      if (primaryBtn) {
        primaryBtn.click();
        return 'primary-fallback';
      }
      return null;
    });
    if (clicked) {
      console.log(`   🚀 Clicked Submit button using evaluate fallback: ${clicked}`);
      return true;
    }
  } catch {}

  return false;
}

async function internshalaConfirmed(page) {
  return await page.evaluate(() => {
    const t = document.body.innerText.toLowerCase();
    return (
      t.includes("successfully applied") ||
      t.includes("application submitted") ||
      t.includes("application sent") ||
      t.includes("congratulations")
    );
  });
}

async function smartFillForm(page, job, jdText) {
  // 1. Textareas
  const textareas = await page.$$("textarea");
  for (const el of textareas) {
    if (!(await el.isVisible())) continue;
    if ((await el.inputValue()).trim()) continue;

    const question = await page.evaluate(
      e => e.closest(".form-group")?.innerText || e.closest("label")?.innerText || e.placeholder || "Explain why you want to apply",
      el
    );

    const answer = await askAI(question, jdText, job.title, job.company);
    await el.fill(String(answer));
    await page.waitForTimeout(500);
  }

  // 2. Contenteditables
  const editables = await page.$$("[contenteditable='true']");
  for (const el of editables) {
    if (!(await el.isVisible())) continue;
    const existing = await el.innerText();
    if (existing && existing.trim().length > 10) continue;

    const question = await page.evaluate(
      e => e.closest(".form-group")?.innerText || e.closest("label")?.innerText || "Explain",
      el
    );

    const answer = await askAI(question, jdText, job.title, job.company);
    await el.click({ force: true });
    await el.evaluate((node, value) => {
      node.innerText = value;
      node.dispatchEvent(new Event("input", { bubbles: true }));
    }, answer);
    await page.waitForTimeout(500);
  }

  // 3. Inputs
  const inputs = await page.$$("input");
  for (const el of inputs) {
    if (!(await el.isVisible())) continue;
    const t = (await el.getAttribute("type")) || "text";
    if (["radio", "checkbox", "submit", "button"].includes(t)) continue;
    if ((await el.inputValue()).trim()) continue;

    const question = await page.evaluate(
      e => e.closest(".form-group")?.innerText || e.closest("label")?.innerText || e.placeholder || "Input",
      el
    );

    const simple = getSimpleAnswer(question);
    if (simple !== null) {
      await el.fill(String(simple));
    } else {
      const answer = await askAI(question, jdText, job.title, job.company);
      await el.fill(String(answer));
    }
    await page.waitForTimeout(500);
  }

  // 4. Radios
  await page.evaluate(() => {
    const groups = {};
    document.querySelectorAll("input[type='radio']").forEach(r => {
      const name = r.name || Math.random().toString();
      groups[name] = groups[name] || [];
      groups[name].push(r);
    });

    Object.values(groups).forEach(radios => {
      const yes = radios.find(r =>
        r.closest("label")?.innerText.toLowerCase().includes("yes")
      );
      (yes || radios[0]).click();
    });
  });

  // 5. Dropdowns & Comboboxes
  await page.evaluate(() => {
    document.querySelectorAll("select").forEach(sel => {
      if (!sel.value && sel.options.length > 1) {
        sel.selectedIndex = sel.options.length >= 2 ? 1 : 0;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    document.querySelectorAll("[role='combobox'], button[aria-haspopup='listbox']").forEach(box => {
      box.click();
      const options = document.querySelectorAll("[role='option']");
      if (options.length) {
        (options[0]).click();
      }
    });
  });
}

(async () => {
  const profile = (process.argv[2] || "Web Development").trim();
  console.log(`🔎 Target Profile: "${profile}"`);

  let keywords = ["web", "development", "developer", "frontend", "backend", "full stack", "react", "node", "javascript", "html", "css", "software", "programmer"];
  let searchUrl = "https://internshala.com/internships/web-development-internship/";

  const profileLower = profile.toLowerCase();
  if (profileLower.includes("marketing") || profileLower.includes("social media") || profileLower.includes("digital")) {
    keywords = ["marketing", "social media", "content", "graphic", "canva", "seo", "instagram", "facebook", "digital", "creative", "design", "video", "copywriter", "writer", "brand"];
    searchUrl = "https://internshala.com/internships/social-media-marketing-internship/";
  } else if (profileLower.includes("backend")) {
    keywords = ["backend", "node", "python", "django", "flask", "java", "spring", "golang", "c++", "developer", "software"];
    searchUrl = "https://internshala.com/internships/backend-development-internship/";
  } else if (profileLower.includes("mobile") || profileLower.includes("android") || profileLower.includes("ios") || profileLower.includes("app")) {
    keywords = ["android", "ios", "swift", "kotlin", "flutter", "react native", "mobile", "app", "developer"];
    searchUrl = "https://internshala.com/internships/mobile-app-development-internship/";
  } else if (!profileLower.includes("web")) {
    // If not a predefined profile, default to general page with custom search keywords
    keywords = profileLower.split(/\s+/).filter(k => k.length > 2);
    searchUrl = "https://internshala.com/internships/";
  }

  console.log("🌐 Connecting to Electron App via CDP port 9222...");
  let browser;
  try {
    browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
  } catch (err) {
    console.error("❌ Failed to connect on port 9222. Is the Electron app dev server running?", err.message);
    process.exit(1);
  }
  
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().includes("internshala.com"));
  if (!page) {
    page = context.pages().find(p => p.url().startsWith("http"));
  }
  if (!page) {
    console.log("⚠️ No active HTTP/HTTPS page found. Creating a new tab.");
    page = await context.newPage();
  }
  
  console.log(`✅ Connected! Active URL: ${page.url()}`);
  
  // Clear beforeunload on the current page immediately before we navigate away
  try {
    await page.evaluate(() => {
      window.onbeforeunload = null;
      if (window.BeforeUnloadEvent) {
        Object.defineProperty(BeforeUnloadEvent.prototype, 'returnValue', {
          get() { return undefined; },
          set() {},
          configurable: true
        });
      }
    }).catch(() => {});
  } catch (e) {}

  // Handle dialogs safely to prevent ProtocolError
  page.on('dialog', async dialog => {
    console.log(`💬 Browser dialog popped up: [${dialog.type()}] "${dialog.message()}"`);
    try {
      await dialog.accept().catch(() => {});
    } catch (err) {
      console.log(`   ⚠️ Dialog accept failed (possibly already closed): ${err.message}`);
    }
  });

  // Suppress beforeunload dialogs for future pages
  try {
    await page.addInitScript(() => {
      try {
        if (window.BeforeUnloadEvent) {
          Object.defineProperty(BeforeUnloadEvent.prototype, 'returnValue', {
            get() { return undefined; },
            set() {},
            configurable: true
          });
        }
        window.onbeforeunload = null;
      } catch (e) {}
    }).catch(() => {});
  } catch (e) {}

  console.log(`🔍 Navigating directly to search URL: ${searchUrl}`);
  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  } catch (gotoErr) {
    console.log(`⚠️ Initial navigation aborted or timed out: ${gotoErr.message}. Trying once more...`);
    // Retry once with a brief delay
    await page.waitForTimeout(2000);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  await page.waitForTimeout(3000);
  
  // If we loaded the general internships page, apply filters via Chosen search input
  if (searchUrl === "https://internshala.com/internships/") {
    try {
      const clearBtn = page.getByRole("link", { name: /clear all/i }).filter({ visible: true });
      if (await clearBtn.count()) {
        await clearBtn.first().click({ force: true });
        await page.waitForTimeout(2000);
      }
    } catch (e) {}

    console.log(`Adding profile filter: '${profile}'...`);
    const chosenInput = page.locator(".chosen-search-input").filter({ visible: true }).first();
    await chosenInput.click({ force: true });
    await page.keyboard.type(profile);
    await page.waitForTimeout(1000);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2500);
  }

  // Check remote (work from home) job checkbox
  console.log("Checking filter: 'Work from home'...");
  const wfhCheckbox = page.locator("#remote_job").filter({ visible: true });
  if (await wfhCheckbox.count()) {
    const isChecked = await wfhCheckbox.isChecked();
    if (!isChecked) {
      await wfhCheckbox.click({ force: true });
      await page.waitForTimeout(3000);
    }
  }

  // Scrape job cards
  const count = await page.locator(".individual_internship").count();
  console.log(`Found ${count} total job cards in search results.`);

  const rawJobs = [];
  const appliedJobs = new Set(loadAppliedJobs().map(j => j.id));

  for (let i = 0; i < count; i++) {
    try {
      const card = page.locator(".individual_internship").nth(i);
      
      // Skip promoted ads
      const promoted = await card.locator(".promoted_tag").count();
      if (promoted > 0) continue;
      
      const titleEl = card.locator("a.job-title-href");
      if (!(await titleEl.count())) continue;
      
      const title = (await titleEl.innerText()).trim();
      const rawLink = await titleEl.getAttribute("href");
      const jobLink = rawLink.startsWith("http") ? rawLink : `https://internshala.com${rawLink}`;
      
      // Skip external third-party links (like LinkedIn, company websites, etc.)
      if (!jobLink.includes("internshala.com")) {
        console.log(`Skipping external job link: ${jobLink}`);
        continue;
      }
      
      const company = (await card.locator(".company-name").innerText()).trim();
      const location = (await card.locator(".locations span").first().innerText()).trim();
      const id = Buffer.from(title + company).toString("base64");

      if (appliedJobs.has(id)) continue;
      if (rawJobs.find(j => j.id === id)) continue;

      // Validate relevance using keywords
      const isRelevant = keywords.some(k => title.toLowerCase().includes(k) || company.toLowerCase().includes(k));
      
      if (isRelevant) {
        rawJobs.push({ id, title, company, location, jobLink });
      }
    } catch (e) {
      // ignore card scrape error
    }
  }

  console.log(`\n📦 Discovered ${rawJobs.length} unapplied relevant jobs.`);
  if (rawJobs.length === 0) {
    console.log("No new matching jobs to apply. Exiting.");
    process.exit(0);
  }

  let appliedCount = 0;
  const appliedList = [];

  for (const job of rawJobs) {
    if (appliedCount >= 10) {
      console.log("\n🎯 Reached target of 10 applications!");
      break;
    }

    console.log(`\n➡️ [${appliedCount + 1}/10] Applying: "${job.title}" @ "${job.company}"`);
    try {
      await page.goto(job.jobLink, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2000);

      // Verify we are still on Internshala
      const currentUrl = page.url();
      if (!currentUrl.includes("internshala.com")) {
        console.log(`⚠️ Page redirected to external site: ${currentUrl}. Skipping.`);
        continue;
      }

      if (await isAlreadyAppliedUI(page)) {
        console.log("Already applied according to UI. Skipping.");
        saveAppliedJob(job.id, job.title, job.company);
        continue;
      }

      const applied = await forceClickApply(page);
      if (!applied) {
        console.log("Could not click Apply button. Skipping.");
        continue;
      }
      await page.waitForTimeout(2500);

      // Verify clicking apply didn't redirect us to an external site
      const afterApplyUrl = page.url();
      if (!afterApplyUrl.includes("internshala.com")) {
        console.log(`⚠️ Clicking Apply redirected to external site: ${afterApplyUrl}. Skipping.`);
        continue;
      }

      // Handle profile review page if present
      const proceedBtn = page.getByRole("button", { name: /proceed/i });
      if (await proceedBtn.count()) {
        console.log("Profile review page detected. Clicking 'Proceed'...");
        try {
          await proceedBtn.first().click({ force: true, timeout: 2000 });
        } catch {
          await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, input[type="button"], a.btn')).find(b => {
              const t = b.innerText.toLowerCase();
              return t.includes('proceed') || t.includes('continue') || t.includes('next');
            });
            if (btn) btn.click();
          });
        }
        await page.waitForTimeout(2500);
      }

      // Check if cover letter form / questions are present
      let jdText = "";
      try {
        jdText = await page.$eval(".internship_details", el => el.innerText.trim());
      } catch (e) {
        jdText = await page.innerText("body");
      }

      console.log("Filling dynamic application questions...");
      await smartFillForm(page, job, jdText);
      await page.waitForTimeout(1000);

      console.log("Clicking Submit...");
      const submitted = await clickSubmit(page);
      if (submitted) {
        await page.waitForTimeout(4000);
        if (await internshalaConfirmed(page)) {
          console.log("🟢 Application CONFIRMED!");
          saveAppliedJob(job.id, job.title, job.company);
          appliedCount++;
          appliedList.push({ Title: job.title, Company: job.company, Status: "Success" });
        } else {
          console.log("⚠️ Submission clicked, but confirmation text not detected.");
          appliedList.push({ Title: job.title, Company: job.company, Status: "Unconfirmed" });
        }
      } else {
        console.log("❌ Submit button not found.");
      }

    } catch (err) {
      console.error(`❌ Error applying to ${job.title}:`, err.message);
    }
  }

  console.log("\n📊 APPLICATIONS SUMMARY TABLE");
  console.table(appliedList);
  
  process.exit(0);
})();
