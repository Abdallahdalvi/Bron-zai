module.exports = async function (bc, args) {
  console.log("🚀 Starting Internshala Apply Skill...");

  // 1. Resolve search profile from arguments
  let profile = "Web Development";
  if (typeof args === "string" && args.trim().length > 0) {
    profile = args.trim();
  } else if (args && typeof args === "object") {
    profile = args.profile || args.query || args[0] || "Web Development";
  }
  console.log(`🔎 Target Role Profile: "${profile}"`);

  // 2. Navigate to student applications dashboard
  console.log("➡️ Navigating to applications dashboard...");
  await bc.navigate("https://internshala.com/student/applications");
  await new Promise(r => setTimeout(r, 3000));

  // Extract application history
  console.log("📊 Extracting application history...");
  const recentAppsResult = await bc.evaluateScript(`
    (() => {
      try {
        const rows = Array.from(document.querySelectorAll('.application_row, .individual_application, .app-row')).slice(0, 3);
        return JSON.stringify(rows.map(el => ({
          role: el.querySelector('.profile, .heading_4_5, .job-title')?.innerText?.trim() || 'N/A',
          company: el.querySelector('.company_name, .heading_6, .company')?.innerText?.trim() || 'N/A',
          status: el.querySelector('.application_status, .status')?.innerText?.trim() || 'N/A'
        })));
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
  console.log(`Found ${recentApps.length} recent applications.`);

  // 3. Navigate to internship search page
  console.log("➡️ Navigating to internship search page...");
  await bc.navigate("https://internshala.com/internships");
  await new Promise(r => setTimeout(r, 3000));

  // Apply filters
  console.log(`⚙️ Filtering for profile "${profile}" and Work from home...`);
  await bc.evaluateScript(`
    (async () => {
      try {
        // Clear all filters if clear link exists to ensure clean state
        const clearLink = Array.from(document.querySelectorAll('a')).find(a => a.innerText.toLowerCase().includes('clear all'));
        if (clearLink) {
          clearLink.click();
          await new Promise(r => setTimeout(r, 1500));
        }

        // Open Chosen input and add profile filter
        const chosenInput = document.querySelector('.chosen-search-input');
        if (chosenInput) {
          chosenInput.click();
          chosenInput.value = ${JSON.stringify(profile)};
          chosenInput.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));
          // Dispatch enter key press
          const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
          chosenInput.dispatchEvent(enterEvent);
          await new Promise(r => setTimeout(r, 1500));
        }

        // Check remote (work from home) job checkbox
        const wfhCheckbox = document.querySelector('#remote_job, #wfh_checkbox, input[type="checkbox"][name*="remote"]');
        if (wfhCheckbox && !wfhCheckbox.checked) {
          wfhCheckbox.click();
        }
      } catch (e) {
        console.error("Error setting filters", e);
      }
    })()
  `);

  // Wait for results to update
  await new Promise(r => setTimeout(r, 3000));

  // 4. Extract top matching listings
  console.log("🔍 Scanning listings...");
  const listingsResult = await bc.evaluateScript(`
    (() => {
      try {
        const cards = Array.from(document.querySelectorAll('.individual_internship')).slice(0, 5);
        return JSON.stringify(cards.map(el => {
          const titleEl = el.querySelector('a.job-title-href, .profile a');
          const companyEl = el.querySelector('.company_name, .company-name');
          const stipendEl = el.querySelector('.stipend') || el.querySelector('.stipend_container');
          
          let duration = 'N/A';
          const details = Array.from(el.querySelectorAll('.item_body, .other_detail_item'));
          const durationMatch = details.find(d => d.innerText.includes('Month') || d.innerText.includes('Week'));
          if (durationMatch) {
            duration = durationMatch.innerText.trim();
          }

          return {
            role: titleEl ? titleEl.innerText.trim() : 'N/A',
            company: companyEl ? companyEl.innerText.trim() : 'N/A',
            stipend: stipendEl ? stipendEl.innerText.trim() : 'N/A',
            duration: duration,
            link: titleEl ? titleEl.href : null
          };
        }));
      } catch (e) {
        return JSON.stringify([]);
      }
    })()
  `);

  let listings = [];
  try {
    listings = JSON.parse(listingsResult);
  } catch (e) {
    console.error("Failed to parse listings", e);
  }

  console.log(`Found ${listings.length} listings.`);

  // 5. Select first native matching listing (skip third-party external redirects)
  const targetJob = listings.find(job => job.link && job.link.includes("internshala.com"));
  if (!targetJob) {
    return {
      success: true,
      message: "No native Internshala internships found in the top listings. (Skipped external third-party listings)",
      recentApps,
      listings
    };
  }

  // 6. Navigate directly to details page in the current window (prevents new tab stuck issues)
  console.log(`➡️ Navigating directly to: "${targetJob.role}" at "${targetJob.company}"`);
  await bc.navigate(targetJob.link);
  await new Promise(r => setTimeout(r, 3000));

  // Check if we navigated to a third-party site anyway
  const detailsUrl = (await bc.getBrowserState()).url || "";
  if (!detailsUrl.includes("internshala.com")) {
    return {
      success: false,
      message: `Redirected to external site: ${detailsUrl}. Skipping auto-apply.`,
      recentApps,
      listings
    };
  }

  // 7. Click Apply Now
  console.log("👉 Clicking Apply Now...");
  const clickApplyResult = await bc.evaluateScript(`
    (() => {
      const applyBtn = document.querySelector('#top_easy_apply_button, #easy_apply_button');
      if (applyBtn) {
        applyBtn.click();
        return 'clicked';
      }
      return 'not_found';
    })()
  `);
  await new Promise(r => setTimeout(r, 2500));

  // Handle profile review proceeds if present
  console.log("👤 Handing profile review steps...");
  await bc.evaluateScript(`
    (() => {
      const proceedBtn = Array.from(document.querySelectorAll('button, input[type="button"]')).find(b => b.innerText.toLowerCase().includes('proceed'));
      if (proceedBtn) {
        proceedBtn.click();
      }
    })()
  `);
  await new Promise(r => setTimeout(r, 2500));

  // 8. Analyze form fields
  console.log("📝 Inspecting application form questions...");
  const formStateResult = await bc.evaluateScript(`
    (() => {
      const textareas = Array.from(document.querySelectorAll('textarea')).filter(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      return JSON.stringify({
        hasQuestions: textareas.length > 0,
        questionCount: textareas.length
      });
    })()
  `);

  let formState = { hasQuestions: false, questionCount: 0 };
  try {
    formState = JSON.parse(formStateResult);
  } catch (e) {}

  if (formState.hasQuestions) {
    console.log("⚠️ Assessment questions detected. Handing control to the user.");
    return {
      success: true,
      message: `Navigated to application form for "${targetJob.role}" at "${targetJob.company}". The application requires answers to ${formState.questionCount} custom question(s). Standard fields have been preloaded. Please complete the cover letter/questions on the page and click Submit.`,
      recentApps,
      listings,
      actionTaken: "Paused for manual completion"
    };
  }

  // 9. No custom questions, submit automatically
  console.log("🚀 No custom questions found. Submitting application automatically...");
  const submitResult = await bc.evaluateScript(`
    (() => {
      const submitBtn = document.querySelector('button[type="submit"], #submit, button:contains("Submit"), input[type="submit"]');
      if (submitBtn) {
        submitBtn.click();
        return 'submitted';
      }
      return 'not_found';
    })()
  `);

  await new Promise(r => setTimeout(r, 4000));

  return {
    success: true,
    message: `Successfully applied to "${targetJob.role}" at "${targetJob.company}" automatically.`,
    recentApps,
    listings,
    actionTaken: "Applied automatically"
  };
};
