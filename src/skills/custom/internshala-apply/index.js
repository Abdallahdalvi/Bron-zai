const fs = require("fs");
const path = require("path");

const DEFAULT_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const APPLIED_JOBS_FILE = path.join(process.cwd(), "applied-jobs-marketing.json");

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

// Save applied job
function saveAppliedJob(jobId, jobTitle, company) {
  const list = loadAppliedJobs();
  if (!list.some(j => j.id === jobId)) {
    list.push({ id: jobId, title: jobTitle, company, date: new Date().toISOString() });
    fs.writeFileSync(APPLIED_JOBS_FILE, JSON.stringify(list, null, 2));
  }
}

// Classify question type
function classifyQuestion(question) {
  const q = question.toLowerCase();
  if (q.includes("cover letter") || q.includes("why should we hire you") || q.includes("why should you be hired") || q.includes("suitability")) {
    return "cover_letter";
  }
  if (q.includes("experience") || q.includes("years") || q.includes("months") || q.includes("how long")) {
    return "experience";
  }
  if (q.includes("notice") || q.includes("joining") || q.includes("available") || q.includes("earliest")) {
    return "notice_period";
  }
  if (q.includes("city") || q.includes("location") || q.includes("where") || q.includes("reside")) {
    return "location";
  }
  if (q.includes("salary") || q.includes("ctc") || q.includes("expectation") || q.includes("stipend")) {
    return "salary";
  }
  if (q.includes("rating") || q.includes("proficiency") || q.includes("scale") || q.includes("rate your")) {
    return "rating";
  }
  if (q.includes("yes") || q.includes("no") || q.includes("do you have") || q.includes("are you")) {
    return "yes_no";
  }
  return "explanation";
}

// Rule-based answer resolver
function getRuleBasedAnswer(question, type) {
  const q = question.toLowerCase();
  if (type === "experience") {
    if (q.includes("wordpress") || q.includes("landing page") || q.includes("website")) return "2";
    return "3";
  }
  if (type === "notice_period" || q.includes("notice") || q.includes("joining")) {
    return "Immediate";
  }
  if (type === "location" || q.includes("city") || q.includes("reside")) {
    return "Mumbai";
  }
  if (type === "salary" || q.includes("salary") || q.includes("expectation")) {
    return "35000";
  }
  if (type === "rating") {
    return "5";
  }
  if (type === "yes_no") {
    return "Yes";
  }
  return null;
}

// Clean Unicode characters to ASCII
function sanitizeAnswer(text) {
  if (!text) return "";
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")   // curly single quotes -> '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // curly double quotes -> "
    .replace(/[\u2013]/g, '-')                       // en-dash -> hyphen
    .replace(/[\u2014\u2015]/g, ' - ')               // em-dash -> " - "
    .replace(/[\u2026]/g, '...')                     // ellipsis -> ...
    .replace(/[\u2022\u2023\u25E6\u2043\u2219]/g, '-') // bullet points -> -
    .replace(/[\u00A0]/g, ' ')                       // non-breaking space -> space
    .replace(/[^\x00-\x7F]/g, '');                   // strip any remaining non-ASCII
}

// OpenRouter AI Generation Helper
async function askAI(question, jdText, jobTitle, company, apiKey, model) {
  console.log(`🤖 Requesting AI response for assessment question: "${question.substring(0, 70).replace(/\n/g, ' ')}..."`);
  
  // Try loading resume
  let resume = "Abdallah Dalvi - Social Media Manager | Digital Marketing & Web Specialist. Has 3+ years of experience. Expert in Canva, Meta Suite, and website/landing page management (WordPress). Built and maintained gerrysonmehta.com.";
  try {
    const resumePath = path.join(process.cwd(), "resume_text.txt");
    if (fs.existsSync(resumePath)) {
      resume = fs.readFileSync(resumePath, "utf8");
    }
  } catch (e) {
    console.warn("Could not read resume_text.txt, using fallback profile");
  }

  const prompt = `
You are an expert job application assistant. Write a customized, highly professional, 3-sentence cover letter/answer for this application question.

CANDIDATE RESUME:
${resume}

JOB DETAILS:
- Title: ${jobTitle}
- Company: ${company}
- Job Description Context: ${jdText}

QUESTION:
"${question}"

RULES:
1. Provide EXACTLY a 3-sentence response. No more, no less.
2. Customization: Tailor it specifically to the Job Description and candidate's experience (especially website management, WordPress, or digital marketing skills if relevant).
3. Be professional, enthusiastic, and confident.
4. Do NOT use any emojis.
5. Return ONLY the answer text. No extra headers, introductory phrases, or polite filler. Just start directly with the first sentence of your response.
6. Use plain ASCII characters only. No curly quotes or special dashes.
`;

  try {
    const key = apiKey && apiKey.trim() ? apiKey.trim() : DEFAULT_OPENROUTER_KEY;
    const modelToUse = model || "google/gemini-2.5-flash";
    
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "HTTP-Referer": "https://github.com/Abdallahdalvi/Bron-zai",
        "X-Title": "Bron Job Assistant"
      },
      body: JSON.stringify({
        model: modelToUse,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.5
      })
    });
    const data = await response.json();
    if (data.choices && data.choices.length > 0) {
      const ans = data.choices[0].message.content.trim();
      return sanitizeAnswer(ans);
    }
  } catch (error) {
    console.error("AI Generation Error:", error.message);
  }
  return "I believe my background as a digital marketing specialist and experience managing WordPress websites and landing pages make me a strong fit for this role. I am highly motivated to contribute to your team's success and start delivering value immediately. I look forward to the opportunity to discuss my qualifications further.";
}

module.exports = async function (bc, args) {
  console.log("🚀 Starting Programmatic Internshala Apply Skill...");

  // 1. Resolve search profile from arguments
  let profile = "Web Development";
  if (typeof args === "string" && args.trim().length > 0) {
    profile = args.trim();
  } else if (args && typeof args === "object") {
    profile = args.profile || args.query || args[0] || "Web Development";
  }
  console.log(`🔎 Target Role Profile: "${profile}"`);

  // Try loading settings for OpenRouter key and model
  let apiKey = "";
  let model = "";
  try {
    const { getSettings } = require("../../../main/memory");
    const settings = getSettings();
    apiKey = settings.apiKey;
    model = settings.model;
  } catch (e) {
    console.warn("Could not load internal settings, using default OpenAI/OpenRouter key");
  }

  // 2. Navigate to student applications dashboard to extract history
  console.log("➡️ Extracting recent applications to avoid duplicates...");
  await bc.navigate("https://internshala.com/student/applications");
  await new Promise(r => setTimeout(r, 3000));

  const recentAppsResult = await bc.evaluateScript(`
    (() => {
      try {
        const rows = Array.from(document.querySelectorAll('.application_row, .individual_application, .app-row')).slice(0, 50);
        return JSON.stringify(rows.map(el => {
          const role = el.querySelector('.profile, .heading_4_5, .job-title')?.innerText?.trim() || '';
          const company = el.querySelector('.company_name, .heading_6, .company')?.innerText?.trim() || '';
          return { role, company };
        }));
      } catch (e) {
        return JSON.stringify([]);
      }
    })()
  `);

  let recentApps = [];
  try {
    recentApps = JSON.parse(recentAppsResult);
  } catch (e) {
    console.error("Failed to parse recent applications", e);
  }
  console.log(`Found ${recentApps.length} recent applications in history.`);

  // Maintain local applied jobs list
  const appliedJobs = new Set(loadAppliedJobs().map(j => j.id));
  recentApps.forEach(app => {
    if (app.role && app.company) {
      const id = Buffer.from(app.role + app.company).toString("base64");
      appliedJobs.add(id);
    }
  });

  // 3. Navigate directly to internship search page
  // Use direct URL shortcut for Web Development to bypass search input filters
  let searchUrl = "https://internshala.com/internships";
  const profileLower = profile.toLowerCase();
  if (profileLower.includes("web dev")) {
    searchUrl = "https://internshala.com/internships/web-development-internship/";
    console.log("➡️ Navigating directly to Web Development search URL shortcut...");
  } else if (profileLower.includes("digital marketing")) {
    searchUrl = "https://internshala.com/internships/digital-marketing-internship/";
    console.log("➡️ Navigating directly to Digital Marketing search URL shortcut...");
  } else if (profileLower.includes("social media")) {
    searchUrl = "https://internshala.com/internships/social-media-marketing-internship/";
    console.log("➡️ Navigating directly to Social Media Marketing search URL shortcut...");
  } else {
    console.log("➡️ Navigating to general internships search page...");
  }

  await bc.navigate(searchUrl);
  await new Promise(r => setTimeout(r, 4000));

  // If we navigated to general page, type keyword in chosen filter input
  if (searchUrl === "https://internshala.com/internships") {
    console.log(`⚙️ Filtering for profile "${profile}" via search input...`);
    await bc.evaluateScript(`
      (async () => {
        try {
          const chosenInput = document.querySelector('.chosen-search-input');
          if (chosenInput) {
            chosenInput.click();
            chosenInput.value = ${JSON.stringify(profile)};
            chosenInput.dispatchEvent(new Event('input', { bubbles: true }));
            await new Promise(r => setTimeout(r, 500));
            chosenInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          }
        } catch (e) {}
      })()
    `);
    await new Promise(r => setTimeout(r, 3000));
  }

  // Check remote (work from home) job checkbox
  console.log("Checking filter: 'Work from home'...");
  await bc.evaluateScript(`
    (() => {
      try {
        const wfhCheckbox = document.querySelector('#remote_job, #wfh_checkbox, input[type="checkbox"][name*="remote"]');
        if (wfhCheckbox && !wfhCheckbox.checked) {
          wfhCheckbox.click();
          return 'clicked';
        }
      } catch (e) {}
      return 'ignored';
    })()
  `);
  await new Promise(r => setTimeout(r, 3000));

  // 4. Scrape listings on the first page
  console.log("🔍 Scanning matching listings on DOM...");
  const listingsResult = await bc.evaluateScript(`
    (() => {
      try {
        const cards = Array.from(document.querySelectorAll('.individual_internship, .job-container'));
        return JSON.stringify(cards.map(el => {
          // Skip promoted ads if possible
          if (el.querySelector('.promoted_tag')) return null;

          const titleEl = el.querySelector('a.job-title-href, .profile a, #job_title');
          const companyEl = el.querySelector('.company_name, .company-name');
          const stipendEl = el.querySelector('.stipend') || el.querySelector('.stipend_container');
          
          let duration = 'N/A';
          const details = Array.from(el.querySelectorAll('.item_body, .other_detail_item'));
          const durationMatch = details.find(d => d.innerText.includes('Month') || d.innerText.includes('Week'));
          if (durationMatch) {
            duration = durationMatch.innerText.trim();
          }

          const rawLink = titleEl ? titleEl.getAttribute('href') : null;
          const link = rawLink ? (rawLink.startsWith('http') ? rawLink : 'https://internshala.com' + rawLink) : null;

          return {
            title: titleEl ? titleEl.innerText.trim() : 'N/A',
            company: companyEl ? companyEl.innerText.trim() : 'N/A',
            stipend: stipendEl ? stipendEl.innerText.trim() : 'N/A',
            duration: duration,
            link
          };
        }).filter(Boolean));
      } catch (e) {
        return JSON.stringify([]);
      }
    })()
  `);

  let listings = [];
  try {
    const parsedListings = JSON.parse(listingsResult);
    listings = parsedListings.map(j => {
      const title = j.title || j.role || 'N/A';
      return { ...j, title, role: title };
    });
  } catch (e) {
    console.error("Failed to parse listings", e);
  }

  // Filter listings: must be native Internshala links and not already applied
  const relevantListings = listings.filter(job => {
    if (!job.link || !job.link.includes("internshala.com")) return false;
    const id = Buffer.from(job.title + job.company).toString("base64");
    return !appliedJobs.has(id);
  });

  console.log(`Found ${listings.length} total listings, ${relevantListings.length} are unapplied and native.`);

  if (relevantListings.length === 0) {
    return {
      success: true,
      message: "No new unapplied native Internshala internships found in the listings.",
      listings
    };
  }

  let appliedCount = 0;
  const appliedList = [];

  // Loop through and apply to listings sequentially
  for (const job of relevantListings) {
    if (appliedCount >= 10) {
      console.log("\n🎯 Reached session limit of 10 applications!");
      break;
    }

    const jobId = Buffer.from(job.title + job.company).toString("base64");
    console.log(`\n➡️ [${appliedCount + 1}] Applying to: "${job.title}" at "${job.company}"`);
    
    try {
      // Navigate to detail page
      await bc.navigate(job.link);
      await new Promise(r => setTimeout(r, 4000));

      // UI Applied Check
      const uiAlreadyApplied = await bc.evaluateScript(`
        (() => {
          const text = document.body.innerText.toLowerCase();
          return text.includes("already applied") || text.includes("you have applied");
        })()
      `);
      if (uiAlreadyApplied === "true") {
        console.log("⏭️ Already applied according to UI. Skipping.");
        saveAppliedJob(jobId, job.title, job.company);
        continue;
      }

      // Extract Job Description text
      const jdText = await bc.evaluateScript(`
        (() => {
          const el = document.querySelector('.internship_details, .job_details_container, .about_the_job, .text-container');
          return el ? el.innerText.trim() : document.body.innerText.trim().slice(0, 3000);
        })()
      `);

      // Click Apply Now
      console.log("👉 Clicking Apply Now...");
      const applyClicked = await bc.evaluateScript(`
        (() => {
          const btn = document.querySelector('#top_easy_apply_button, #easy_apply_button, button:has-text("Apply now")');
          if (btn) {
            btn.click();
            return 'clicked';
          }
          return 'not_found';
        })()
      `);

      if (applyClicked !== 'clicked') {
        console.log("🚫 Apply button not found. Skipping.");
        continue;
      }
      await new Promise(r => setTimeout(r, 3000));

      // Handle profile review proceeds
      await bc.evaluateScript(`
        (() => {
          const proceedBtn = Array.from(document.querySelectorAll('button, input[type="button"], a.btn')).find(b => {
            const t = b.innerText.toLowerCase();
            return t.includes('proceed') || t.includes('continue') || t.includes('next');
          });
          if (proceedBtn) {
            proceedBtn.click();
            return 'proceed_clicked';
          }
          return 'no_proceed';
        })()
      `);
      await new Promise(r => setTimeout(r, 3000));

      // Identify application form questions
      const questionsJson = await bc.evaluateScript(`
        (() => {
          // Identify textareas
          const textareas = Array.from(document.querySelectorAll('textarea')).filter(el => {
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          });

          // Identify inputs
          const inputs = Array.from(document.querySelectorAll('input')).filter(el => {
            const style = window.getComputedStyle(el);
            const type = el.getAttribute('type') || 'text';
            return style.display !== 'none' && style.visibility !== 'hidden' && 
                   !['radio', 'checkbox', 'submit', 'button', 'hidden', 'file'].includes(type) &&
                   !el.value.trim();
          });

          const questions = [];

          textareas.forEach((el, index) => {
            const group = el.closest('.form-group') || el.closest('.question_container') || el.parentElement;
            const text = group ? group.innerText.split('\\n')[0].trim() : el.placeholder || 'Cover letter / Explanation';
            // Generate unique temporary selector
            const selId = 'textarea_q_' + index;
            el.setAttribute('data-skill-sel', selId);
            questions.push({
              type: 'textarea',
              selector: 'textarea[data-skill-sel="' + selId + '"]',
              question: text
            });
          });

          inputs.forEach((el, index) => {
            const group = el.closest('.form-group') || el.closest('.question_container') || el.parentElement;
            const text = group ? group.innerText.split('\\n')[0].trim() : el.placeholder || 'Input field';
            const selId = 'input_q_' + index;
            el.setAttribute('data-skill-sel', selId);
            questions.push({
              type: 'input',
              selector: 'input[data-skill-sel="' + selId + '"]',
              question: text
            });
          });

          return JSON.stringify(questions);
        })()
      `);

      let questions = [];
      try {
        const parsed = JSON.parse(questionsJson);
        if (Array.isArray(parsed)) {
          questions = parsed;
        }
      } catch (e) {}

      console.log(`Form has ${questions.length} question fields to fill.`);

      // Fill questions
      for (const qInfo of questions) {
        const qType = classifyQuestion(qInfo.question);
        const ruleAnswer = getRuleBasedAnswer(qInfo.question, qType);

        let finalAnswer = "";
        if (ruleAnswer !== null) {
          finalAnswer = ruleAnswer;
        } else {
          // AI generated answer
          finalAnswer = await askAI(qInfo.question, jdText, job.title, job.company, apiKey, model);
        }

        console.log(`   Filling field [${qInfo.type}] "${qInfo.question.substring(0, 45)}..." -> "${finalAnswer.substring(0, 50)}..."`);
        
        // Fill the field on the page
        await bc.evaluateScript(`
          (() => {
            const el = document.querySelector('${qInfo.selector}');
            if (el) {
              el.value = ${JSON.stringify(finalAnswer)};
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              return 'filled';
            }
            return 'not_found';
          })()
        `);
        await new Promise(r => setTimeout(r, 800));
      }

      // Handle Chosen.js custom select dropdowns
      console.log("Selecting Chosen.js / standard dropdown options...");
      await bc.evaluateScript(`
        (async () => {
          // Standard selects
          document.querySelectorAll('select').forEach(sel => {
            if (!sel.value && sel.options.length > 1) {
              sel.selectedIndex = sel.options.length >= 2 ? 1 : 0;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          });

          // Chosen dropdowns (JS click fallback)
          document.querySelectorAll('.chosen-container').forEach(container => {
            const active = container.querySelector('.chosen-single');
            if (active) {
              active.click();
              const items = container.querySelectorAll('.chosen-results li.active-result');
              if (items.length > 0) {
                // Click last item for ratings, else first real item
                const ratingQ = container.closest('.form-group')?.innerText.toLowerCase().includes('rate');
                const target = ratingQ ? items[items.length - 1] : items[0];
                if (target) target.click();
              }
            }
          });
        })()
      `);
      await new Promise(r => setTimeout(r, 1000));

      // Click radio buttons (defaulting to Yes / Immediate availability)
      console.log("Checking radio buttons...");
      await bc.evaluateScript(`
        (() => {
          const groups = {};
          document.querySelectorAll("input[type='radio']").forEach(r => {
            const name = r.name || Math.random().toString();
            groups[name] = groups[name] || [];
            groups[name].push(r);
          });

          Object.values(groups).forEach(radios => {
            const alreadyChecked = radios.some(r => r.checked);
            if (alreadyChecked) return;

            const yes = radios.find(r =>
              r.closest("label")?.innerText.toLowerCase().includes("yes") ||
              r.closest("label")?.innerText.toLowerCase().includes("immediate")
            );
            const target = yes || radios[0];
            if (target) {
              const label = target.closest('label');
              if (label) label.click();
              else target.click();
            }
          });
        })()
      `);
      await new Promise(r => setTimeout(r, 1000));

      // Check checkboxes if unchecked
      await bc.evaluateScript(`
        (() => {
          document.querySelectorAll("input[type='checkbox']").forEach(cb => {
            if (!cb.checked) {
              const label = cb.closest('label') || document.querySelector('label[for="' + cb.id + '"]');
              if (label) label.click();
              else cb.click();
            }
          });
        })()
      `);
      await new Promise(r => setTimeout(r, 1000));

      // Submit application
      console.log("🚀 Submitting application...");
      const submitClicked = await bc.evaluateScript(`
        (() => {
          const btn = document.querySelector('button[type="submit"], #submit, button:has-text("Submit"), input[type="submit"]');
          if (btn) {
            btn.click();
            return 'submitted';
          }
          return 'not_found';
        })()
      `);

      if (submitClicked !== 'submitted') {
        console.log("❌ Submit button not found on page.");
        continue;
      }
      await new Promise(r => setTimeout(r, 4000));

      // Confirm success
      const confirmationText = await bc.evaluateScript(`
        (() => {
          const t = document.body.innerText.toLowerCase();
          const confirmed = t.includes("successfully applied") ||
                            t.includes("application submitted") ||
                            t.includes("application sent") ||
                            t.includes("congratulations");
          return confirmed ? 'yes' : 'no';
        })()
      `);

      if (confirmationText === 'yes') {
        console.log(`🟢 Successfully applied to "${job.title}" @ "${job.company}"!`);
        saveAppliedJob(jobId, job.title, job.company);
        appliedCount++;
        appliedList.push({ role: job.title, company: job.company, status: "Applied" });
      } else {
        console.log("⚠️ Submit clicked, but application confirmation was not verified.");
        appliedList.push({ role: job.title, company: job.company, status: "Submitted (Unconfirmed)" });
      }

    } catch (err) {
      console.error(`❌ Error applying to "${job.title}" at "${job.company}":`, err.message);
    }

    // Delay between applications
    await new Promise(r => setTimeout(r, 3000));
  }

  // Return final run report
  console.log("\n📊 Session Summary:");
  console.table(appliedList);

  return {
    success: true,
    message: `Internshala programmatic apply complete. Applied to ${appliedCount} role(s) successfully.`,
    appliedList
  };
};
