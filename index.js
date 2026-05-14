/**
 * ARRISE Job Scraper - Main Entry Point
 * 
 * PURPOSE: Scrapes job listings from ARRISE Careers website and stores them in Solr.
 * This is the primary orchestrator that coordinates company validation, job scraping,
 * data transformation, and Solr storage.
 */

import dotenv from "dotenv";
dotenv.config();

import fetch from "node-fetch";
import * as cheerio from "cheerio";
import fs from "fs";
import { fileURLToPath } from "url";
import { validateAndGetCompany } from "./company.js";
import { querySOLR, deleteJobByUrl, upsertJobs } from "./solr.js";

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

// ARRISE's unique identifier in Romanian business registry (CIF/CUI)
const COMPANY_CIF = "40181178";

// Request timeout in milliseconds (10 seconds)
const TIMEOUT = 10000;

// Base URL for ARRISE job listings
const JOB_BASE = "https://arrise.com";
const JOBS_LISTING_URL = "https://arrise.com/careers/job/";

// Global variable to store company name after validation
let COMPANY_NAME = null;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================================
// WEB SCRAPING - Fetching and parsing ARRISE Careers HTML pages
// ============================================================================

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  
  if (!res.ok) {
    throw new Error(`HTTP error ${res.status} for ${url}`);
  }
  
  const html = await res.text();
  return html;
}

function parseJobsFromHtml(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  $("a[href^='/careers/job/'], a[href^='https://arrise.com/careers/job/']").each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).find("h3, h4, .job-title").text().trim() || $(el).text().trim();

    if (href && title && title.length > 5) {
      const url = href.startsWith("http") ? href : `${JOB_BASE}${href}`;

      let location = [];
      let workmode = undefined;

      $(el).find(".position-card-text-bottom-item").each((_, item) => {
        const imgAlt = $(item).find("img").attr("alt") || "";
        const text = $(item).find("p").text().trim();
        if (imgAlt.includes("location")) {
          location.push(text);
        } else if (imgAlt.includes("employment") || imgAlt.includes("desktop")) {
          const lower = text.toLowerCase();
          if (lower.includes("on site") || lower.includes("on-site")) workmode = "on-site";
          else if (lower.includes("remote")) workmode = "remote";
          else if (lower.includes("hybrid")) workmode = "hybrid";
        }
      });

      jobs.push({
        url,
        title: title.replace(/\s+/g, " ").trim(),
        uid: href.split("/").pop(),
        workmode,
        location,
        tags: []
      });
    }
  });

  return jobs;
}

async function scrapeJobDetails(jobUrl) {
  try {
    const html = await fetchPage(jobUrl);
    const $ = cheerio.load(html);

    const job = {
      url: jobUrl,
      title: "",
      workmode: undefined,
      location: [],
      tags: []
    };

    job.title = $("h1").first().text().trim();

    $(".tag").each((_, el) => {
      const iconClass = $(el).find(".tag-icon").attr("class") || "";
      const text = $(el).find(".tag-label").text().trim();
      if (iconClass.includes("location")) {
        job.location.push(text);
      } else if (iconClass.includes("clock")) {
        const lower = text.toLowerCase();
        if (lower.includes("on site") || lower.includes("on-site")) job.workmode = "on-site";
        else if (lower.includes("remote")) job.workmode = "remote";
        else if (lower.includes("hybrid")) job.workmode = "hybrid";
      }
    });

    const description = $("main, article, .prose, .content, .job-description").text().trim();

    if (description) {
      const lower = description.toLowerCase();
      const keywords = [
        "english", "romanian", "turkish", "russian", "spanish", "german", "greek", "korean", "portuguese",
        "customer support", "gaming", "casino", "live casino", "igaming",
        "hr", "talent acquisition", "finance", "legal", "compliance",
        "tech", "software", "engineering", "database", "audio visual", "cctv",
        "data", "product", "design", "marketing", "sales",
        "operations", "facilities", "production", "security",
        "electrical", "hvac", "maintenance", "styling", "wardrobe"
      ];
      job.tags = keywords.filter(kw => lower.includes(kw));
    }

    return job;
  } catch (err) {
    console.log(`Warning: Failed to fetch details for ${jobUrl}: ${err.message}`);
    return null;
  }
}

// ============================================================================
// SCRAPING LOGIC - Main scraping workflow
// ============================================================================

async function scrapeAllListings(testOnlyOnePage = false) {
  const allJobs = [];
  const seenUrls = new Set();

  const romanianCities = [
    'Bucharest', 'București', 'Cluj-Napoca', 'Cluj Napoca',
    'Timișoara', 'Timisoara', 'Iași', 'Iasi', 'Brașov', 'Brasov',
    'Constanța', 'Constanta', 'Craiova', 'Bacău', 'Sibiu',
    'Târgu Mureș', 'Targu Mures', 'Oradea', 'Baia Mare', 'Satu Mare',
    'Ploiești', 'Ploiesti', 'Pitești', 'Pitesti', 'Arad', 'Galați', 'Galati',
    'Brăila', 'Braila', 'Drobeta-Turnu Severin', 'Râmnicu Vâlcea', 'Ramnicu Valcea',
    'Buzău', 'Buzau', 'Botoșani', 'Botosani', 'Zalău', 'Zalau', 'Hunedoara', 'Deva',
    'Suceava', 'Bistrița', 'Bistrita', 'Tulcea', 'Călărași', 'Calarasi',
    'Giurgiu', 'Alba Iulia', 'Slatina', 'Piatra Neamț', 'Piatra Neamt', 'Roman',
    'Dumbrăvița', 'Dumbravita', 'Voluntari', 'Popești-Leordeni', 'Popesti-Leordeni',
    'Chitila', 'Mogoșoaia', 'Mogosoaia', 'Otopeni'
  ];
  const citySet = new Set(romanianCities.map(c => c.toLowerCase()));

  console.log("Fetching ARRISE main job listing...");
  const html = await fetchPage(JOBS_LISTING_URL);
  const jobs = parseJobsFromHtml(html);

  console.log(`Found ${jobs.length} job links on main listing page`);

  for (const job of jobs) {
    if (!seenUrls.has(job.url)) {
      seenUrls.add(job.url);
      const isRomania = job.location.some(loc => {
        const lower = loc.toLowerCase().trim();
        return lower === 'romania' || lower === 'românia' || citySet.has(lower);
      });
      if (isRomania) {
        allJobs.push(job);
      }
    }
  }

  console.log(`Jobs with Romanian locations: ${allJobs.length}`);

  const detailsLimit = testOnlyOnePage ? Math.min(3, allJobs.length) : allJobs.length;
  console.log(`Fetching details for ${detailsLimit} jobs...`);

  const detailedJobs = [];
  for (let i = 0; i < Math.min(detailsLimit, allJobs.length); i++) {
    const job = allJobs[i];
    console.log(`[${i + 1}/${detailsLimit}] Fetching: ${job.title}`);

    const details = await scrapeJobDetails(job.url);
    if (details && details.title) {
      detailedJobs.push(details);
    }

    await sleep(500);
  }

  console.log(`Total unique jobs collected: ${detailedJobs.length}`);
  return detailedJobs;
}

// ============================================================================
// DATA TRANSFORMATION - Preparing jobs for Solr storage
// ============================================================================

function mapToJobModel(rawJob, cif, companyName = COMPANY_NAME) {
  const now = new Date().toISOString();

  const job = {
    url: rawJob.url,
    title: rawJob.title,
    company: companyName,
    cif: cif,
    location: rawJob.location?.length ? rawJob.location : undefined,
    tags: rawJob.tags?.length ? rawJob.tags : undefined,
    workmode: rawJob.workmode || undefined,
    date: now,
    status: "scraped"
  };

  Object.keys(job).forEach((k) => job[k] === undefined && delete job[k]);

  return job;
}

function transformJobsForSOLR(payload) {
  const normalizeWorkmode = (wm) => {
    if (!wm) return undefined;
    const lower = wm.toLowerCase();
    if (lower.includes('remote')) return 'remote';
    if (lower.includes('office') || lower.includes('on-site') || lower.includes('site')) return 'on-site';
    return 'hybrid';
  };

  const transformed = {
    ...payload,
    company: payload.company?.toUpperCase(),
    jobs: payload.jobs.map(job => ({
      ...job,
      workmode: normalizeWorkmode(job.workmode)
    }))
  };

  return transformed;
}

// ============================================================================
// MAIN ORCHESTRATION
// ============================================================================

async function main() {
  const testOnlyOnePage = process.argv.includes("--test");
  
  try {
    console.log("=== Step 1: Get existing jobs count ===");
    const existingResult = await querySOLR(COMPANY_CIF);
    const existingCount = existingResult.numFound;
    console.log(`Found ${existingCount} existing jobs in SOLR`);

    console.log("=== Step 2: Validate company via ANAF ===");
    const { company, cif } = await validateAndGetCompany();
    COMPANY_NAME = company;
    const localCif = cif;
    
    const rawJobs = await scrapeAllListings(testOnlyOnePage);
    const scrapedCount = rawJobs.length;
    console.log(`📊 Jobs scraped from ARRISE website: ${scrapedCount}`);

    const jobs = rawJobs.map(job => mapToJobModel(job, localCif));

    const payload = {
      source: "arrise.com",
      scrapedAt: new Date().toISOString(),
      company: COMPANY_NAME,
      cif: localCif,
      jobs
    };

    console.log("Transforming jobs for SOLR...");
    const transformedPayload = transformJobsForSOLR(payload);
    console.log(`📊 Jobs after transform: ${transformedPayload.jobs.length}`);

    const validJobs = transformedPayload.jobs.filter(j => j.title && j.title.trim().length > 0);
    const skippedJobs = transformedPayload.jobs.length - validJobs.length;
    if (skippedJobs > 0) {
      console.log(`⚠️ Skipping ${skippedJobs} jobs with null/empty title:`);
      transformedPayload.jobs.filter(j => !j.title || j.title.trim().length === 0).forEach(j => {
        console.log(`  - ${j.url}`);
      });
    }

    fs.writeFileSync("jobs.json", JSON.stringify({ ...transformedPayload, jobs: validJobs }, null, 2), "utf-8");
    console.log(`Saved ${validJobs.length} jobs to jobs.json`);

    console.log("\n=== Step 3: Upsert jobs to SOLR ===");
    await upsertJobs(validJobs);

    const finalResult = await querySOLR(COMPANY_CIF);
    console.log(`\n📊 === SUMMARY ===`);
    console.log(`📊 Jobs existing in SOLR before scrape: ${existingCount}`);
    console.log(`📊 Jobs scraped from ARRISE website: ${scrapedCount}`);
    console.log(`📊 Jobs in SOLR after scrape: ${finalResult.numFound}`);
    console.log(`====================`);

    console.log("\n=== DONE ===");
    console.log("Scraper completed successfully!");

  } catch (err) {
    console.error("Scraper failed:", err);
    process.exit(1);
  }
}

export { parseJobsFromHtml, mapToJobModel, transformJobsForSOLR };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
