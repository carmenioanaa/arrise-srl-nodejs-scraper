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
const ROMANIA_FILTER_URL = "https://arrise.com/careers/location-of-work/romania/";

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
  
  // Find all job listing links on the page (both relative and absolute URLs)
  $("a[href^='/careers/job/'], a[href^='https://arrise.com/careers/job/']").each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).find("h3, h4, .job-title").text().trim() || $(el).text().trim();
    
    if (href && title && title.length > 5) {
      const url = href.startsWith("http") ? href : `${JOB_BASE}${href}`;
      jobs.push({
        url,
        title: title.replace(/\s+/g, " ").trim(),
        uid: href.split("/").pop(),
        workmode: undefined,
        location: [],
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
      location: ["România"],
      tags: []
    };
    
    job.title = $("h1").first().text().trim();
    
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
    
    const bodyText = $("body").text().toLowerCase();
    if (bodyText.includes("on site") || bodyText.includes("on-site")) {
      job.workmode = "on-site";
    } else if (bodyText.includes("remote")) {
      job.workmode = "remote";
    } else if (bodyText.includes("hybrid")) {
      job.workmode = "hybrid";
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

  console.log("Fetching ARRISE Romania jobs page...");
  const html = await fetchPage(ROMANIA_FILTER_URL);
  const jobs = parseJobsFromHtml(html);
  
  console.log(`Found ${jobs.length} job links on Romania page`);
  
  for (const job of jobs) {
    if (!seenUrls.has(job.url)) {
      seenUrls.add(job.url);
      allJobs.push(job);
    }
  }
  
  if (allJobs.length === 0) {
    console.log("No jobs found on Romania page, trying main listing...");
    const mainHtml = await fetchPage(JOBS_LISTING_URL);
    const mainJobs = parseJobsFromHtml(mainHtml);
    
    for (const job of mainJobs) {
      if (!seenUrls.has(job.url)) {
        seenUrls.add(job.url);
        allJobs.push(job);
      }
    }
  }
  
  // In test mode, only scrape details for first 3 jobs
  const detailsLimit = testOnlyOnePage ? 3 : allJobs.length;
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
    jobs: payload.jobs.map(job => {
      const validLocations = (job.location || []).filter(loc => {
        const lower = loc.toLowerCase().trim();
        if (lower === 'romania' || lower === 'românia') return true;
        return citySet.has(lower);
      }).map(loc => loc.toLowerCase() === 'romania' ? 'România' : loc);

      return {
        ...job,
        location: validLocations.length > 0 ? validLocations : ['România'],
        workmode: normalizeWorkmode(job.workmode)
      };
    })
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
    const validCount = transformedPayload.jobs.filter(j => j.location).length;
    console.log(`📊 Jobs with valid Romanian locations: ${validCount}`);

    fs.writeFileSync("jobs.json", JSON.stringify(transformedPayload, null, 2), "utf-8");
    console.log("Saved jobs.json");

    console.log("\n=== Step 3: Upsert jobs to SOLR ===");
    await upsertJobs(transformedPayload.jobs);

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
